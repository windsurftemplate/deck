# 3. Chatting with the crew

## Sending a message

Type in the box at the bottom of the chat panel and press **Send** or Return. Three dots show while the Chief of Staff starts thinking, then the reply streams in as it is written. If it uses tools along the way (searching memory, creating an issue, handing work to the crew), each step appears in **Crew chat**.

## Saved chats

- **New chat** starts a fresh conversation. <kbd>Cmd</kbd> + <kbd>N</kbd> does the same.
- **Chats** opens the list of saved chats. Click one to reopen it, or rename or delete it.
- Each chat keeps its own history. Memory is shared across all chats, so the crew still knows what you told it elsewhere.
- Deleting a chat removes the conversation, not what the crew learned from it.
- Telegram messages go into one ongoing chat called Telegram. Each automation that the Chief of Staff runs has its own chat.

## Things you can ask for

| You say | What happens |
|---|---|
| "Remember that Sam prefers calls on Fridays" | A fact is saved (through the memory filter) |
| "Create an issue to send the pricing deck to Acme by Thursday" | An issue appears in the tracker |
| "Have GTM draft a follow-up to Dana" | The Chief of Staff delegates; the draft lands in Drafts |
| "Research the latest breaches caused by leaked API keys" | Research searches the web and answers with sources |
| "Do a deep dive on Acme's security team and funding" | A research swarm: 2 to 5 searches in parallel, then one combined brief with sources |
| "Prep me for my meeting with Dana Wright at Acme on Tuesday" | A meeting brief: who they are professionally, company news, our history, talking points, questions. Saved to the second brain |
| "Use GPT for heavy work" | A model change is proposed with **Apply** and **Cancel** |
| "From now on, GTM should never mention pricing" | A crew rule change is proposed for you to apply |
| "Every Monday at 9, have Operations review stale issues" | An automation is proposed for you to apply |

Nothing in the last three rows changes until you press **Apply**.

## Meeting prep: what it will and will not do

Meeting prep works by name, never from a photo. It uses what you already know (memory, issues, your calendar if connected) plus public professional sources: their role, their company's news, and what they have published professionally. Personal life (home, family, health, personal social accounts) is excluded from the searches and filtered from the brief. If the person is not in your memory, give their company so the research stays professional.

## Approvals in chat

When an agent wants to do something that needs you, a card shows the action and its details. **Approve** lets it happen. **Reject** cancels it and teaches the crew (rejections are reviewed during nightly learning). After you approve some actions there is a short undo window.

## Pictures

Turn on **Settings > Camera and pictures** first. Then:

- **Snapshot** opens your camera with a "Camera on" badge. Take the picture and the camera turns off right away.
- **Attach** adds a JPEG, PNG or WebP file.

Up to 3 pictures per message, 5 MB each. Pictures go to your model with the message and are never stored in memory. Any text inside a picture is treated as information, never as instructions. Your model must support images.

## Push-to-talk

Set up **Settings > Voice** first: install whisper.cpp and ffmpeg (for example with Homebrew on a Mac), download a whisper model file, enter both paths, and turn on push-to-talk.

- Press **Talk**, speak, press **Stop** (or Esc). It stops by itself after 2 minutes.
- Your speech is turned into text on your computer, and the text lands in the message box so you can check it before sending.
- The microphone turns off as soon as recording ends. The audio is deleted right away.

**Read replies aloud** uses your computer's built-in voice.

## Hands-free

With push-to-talk set up, turn on **Hands-free** in Settings > Voice and choose a wake word (default "deck").

1. Press **Hands-free** next to Send. A "Microphone on" badge shows the whole time.
2. Say "deck, what is on today?" or "hey deck, draft a follow-up to Dana".
3. The crew answers out loud. For 8 seconds afterward you can reply without the wake word.
4. Press Esc or **Stop hands-free** to turn the microphone fully off.

Only clips that start with the wake word are used. Everything is transcribed on your machine.

## Telegram

Chat with the crew and approve actions from your phone.

1. Create a bot with BotFather in Telegram and copy its token.
2. In **Settings > Telegram**, paste the token and your chat id, and turn it on.
3. Only your chat id can talk to the bot. Messages from anyone else are ignored.

Telegram supports approval buttons, `/apply <id>` for proposals, and voice notes (if voice is set up).
