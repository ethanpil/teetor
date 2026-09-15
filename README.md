# Teetor

Teetor is a web page that changes speech in an MP3 file to text. It uses the OpenRouter transcription API (`/api/v1/audio/transcriptions`).

Live page: https://ethanpil.github.io/teetor/

## How to use

1. Open the page.
2. Type your OpenRouter API key.
3. Type the model name (for example, `openai/whisper-1`).
4. Select an MP3 file, or drag the file onto the page.
5. Click **Transcribe**. The page shows a spinner and a timer until the text comes back. To stop the request, click **Cancel**.
6. Read and edit the text. Click **Download .txt** to save the text.

## Header

The **Add filename and file date/time** switch is on by default. When the switch is on, the text starts with the filename and the date and time of the MP3 file.

## Data loss warnings

The page asks you to confirm before you lose data:

- When you click **Cancel** during a request.
- When you close or reload the page during a request.
- When you close or reload the page, or start a new transcription, and you did not download or copy the text.

## Statistics

After the transcription, the page shows these values:

- Audio length
- Processing time and speed
- Cost and cost for each minute of audio
- Word count and character count
- Input tokens, output tokens and total tokens
- Provider and generation ID

## Data

The page keeps your API key, model name and header setting in the local storage of your browser. The page sends the audio directly to OpenRouter. There is no other server.

## Files

- `index.html`: The page layout. It uses Bootstrap from a CDN.
- `app.js`: The page logic.
