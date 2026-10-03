//! Runs the agent engine (a Node process) and relays JSON lines between it and the UI.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

type Pending = Arc<Mutex<HashMap<u64, Sender<Value>>>>;

pub struct EngineClient {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Pending,
    next: AtomicU64,
}

/// What one line from the engine means.
#[derive(Debug, PartialEq)]
pub enum Incoming {
    Reply(u64, Value),
    Event(Value),
    Junk,
}

pub fn parse_line(line: &str) -> Incoming {
    match serde_json::from_str::<Value>(line) {
        Ok(v) => match v.get("id").and_then(Value::as_u64) {
            Some(id) => Incoming::Reply(id, v),
            None if v.get("event").is_some() => Incoming::Event(v),
            None => Incoming::Junk,
        },
        Err(_) => Incoming::Junk,
    }
}

impl EngineClient {
    /// Starts `program args...`; every event line goes to `on_event`.
    pub fn spawn(program: &str, args: &[String], on_event: Box<dyn Fn(Value) + Send + Sync>) -> Result<Self, String> {
        let mut child = Command::new(program)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("could not start the agent engine: {e}"))?;
        let stdout = child.stdout.take().ok_or("engine has no stdout")?;
        let stdin = child.stdin.take().ok_or("engine has no stdin")?;
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let p = pending.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                match parse_line(&line) {
                    Incoming::Reply(id, v) => {
                        if let Some(tx) = p.lock().unwrap().remove(&id) {
                            let _ = tx.send(v);
                        }
                    }
                    Incoming::Event(v) => on_event(v),
                    Incoming::Junk => {}
                }
            }
            // Engine exited: fail everything still waiting.
            for (_, tx) in p.lock().unwrap().drain() {
                let _ = tx.send(json!({ "error": { "message": "the agent engine stopped" } }));
            }
        });
        Ok(Self { child: Mutex::new(child), stdin: Mutex::new(stdin), pending, next: AtomicU64::new(1) })
    }

    /// Sends one request and waits for its reply.
    pub fn call(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = channel();
        self.pending.lock().unwrap().insert(id, tx);
        let line = json!({ "id": id, "method": method, "params": params }).to_string();
        {
            let mut w = self.stdin.lock().unwrap();
            if writeln!(w, "{line}").and_then(|_| w.flush()).is_err() {
                self.pending.lock().unwrap().remove(&id);
                return Err("the agent engine is not running".into());
            }
        }
        let reply = rx.recv_timeout(timeout).map_err(|_| {
            self.pending.lock().unwrap().remove(&id);
            format!("the agent engine did not answer {method} in time")
        })?;
        if let Some(e) = reply.get("error") {
            return Err(e.get("message").and_then(Value::as_str).unwrap_or("engine error").to_string());
        }
        Ok(reply.get("result").cloned().unwrap_or(Value::Null))
    }

    pub fn stop(&self) {
        let _ = self.child.lock().unwrap().kill();
    }
}

impl Drop for EngineClient {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_replies_events_and_junk() {
        assert_eq!(parse_line(r#"{"id":3,"result":1}"#), Incoming::Reply(3, json!({"id":3,"result":1})));
        assert!(matches!(parse_line(r#"{"event":"check","data":{}}"#), Incoming::Event(_)));
        assert_eq!(parse_line("hello"), Incoming::Junk);
        assert_eq!(parse_line(r#"{"x":1}"#), Incoming::Junk);
    }

    /// A stand-in engine: answers ping, fails boom, and emits an event on start.
    const FAKE: &str = r#"
const rl=require('readline').createInterface({input:process.stdin});
console.log(JSON.stringify({event:'ready',data:{}}));
rl.on('line',l=>{const r=JSON.parse(l);
 if(r.method==='ping')console.log(JSON.stringify({id:r.id,result:'pong'}));
 else if(r.method==='boom')console.log(JSON.stringify({id:r.id,error:{message:'nope'}}));});
"#;

    #[test]
    fn round_trips_with_a_real_process() {
        if Command::new("node").arg("--version").output().is_err() {
            return; // no Node on this machine
        }
        let events = Arc::new(Mutex::new(Vec::new()));
        let ev = events.clone();
        let c = EngineClient::spawn("node", &["-e".into(), FAKE.into()], Box::new(move |v| ev.lock().unwrap().push(v))).unwrap();
        assert_eq!(c.call("ping", json!({}), Duration::from_secs(10)).unwrap(), json!("pong"));
        assert_eq!(c.call("boom", json!({}), Duration::from_secs(10)).unwrap_err(), "nope");
        assert!(c.call("silent", json!({}), Duration::from_millis(300)).unwrap_err().contains("did not answer"));
        assert_eq!(events.lock().unwrap()[0]["event"], "ready");
        c.stop();
    }
}
