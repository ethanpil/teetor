# Teetor

Teetor is a web page that changes speech in an MP3 file to text. It uses the OpenRouter transcription API (`/api/v1/audio/transcriptions`).

Live page: https://ethanpil.github.io/teetor/

## How to use

1. Open the page.
2. Type your OpenRouter API key.
3. Type the model name (for example, `openai/whisper-1`), or select a saved model.
4. Select an MP3 file, or drag the file onto the page.
5. Click **Transcribe**. The page shows a spinner and a timer until the text comes back. To stop the request, click **Cancel**.
6. Read and edit the text. Click **Download .txt** to save the text.

## Saved models

After a transcription gives text, the page saves the model name. When you type in the model field, the page suggests saved models. To see all saved models, click the **▾** button next to the field. Click a model to select it. Click **X** to remove a model from the list.

## Provider settings

In **Provider settings**, type one option on each line in the format `path.to.option = value`. The page makes an object from the lines and sends it as the `provider` field of each request. The text below the field shows this object. OpenRouter sends only the options for the provider that does the transcription. For the provider names, see the endpoints API (`/api/v1/models/<model>/endpoints`).

Example to identify speakers with Azure:

```
options.azure.diarization.enabled = true
```

Rules:

- The `provider.` at the start of a path is optional.
- The values `true`, `false`, `null`, numbers, `"quoted text"` and `[lists]` are JSON values. All other values are text.
- The page ignores empty lines and lines that start with `#`. To stop one option, put `#` at the start of its line.
- You can also type a full JSON object.

To stop all provider settings without deleting them, set the **Send** switch to off.

If the response has speaker labels, the page starts a new paragraph for each change of speaker (for example, `Speaker 0: ...`). If the page divides the file into parts, the provider gives the speaker numbers again for each part. Thus, `Speaker 0` in one part is possibly not the same person as `Speaker 0` in a different part.

## Large files

OpenRouter does not accept large uploads. Also, providers stop a request after approximately 60 seconds of processing. Thus, the page divides an MP3 file that is larger than 12 MB into parts of approximately 8 MB (approximately 8 minutes at 128 kbps). The page sends the parts one after the other and joins the text.

To prevent a split in a word, the page decodes approximately 38 seconds of audio around each split point. It finds the quietest 500 ms and splits the file at the MP3 frame at that time. If the audio has no pause, the split can still be in a word.

If a part gets a rate limit error (HTTP 429) or a server error (HTTP 5xx), the page waits and tries again. It waits 5, 15, 30 and 60 seconds before the retries. The progress panel shows the time until the next retry. The page does not try again for other errors, for example not enough credits.

If a part fails, the page shows the text of the parts that are finished. To continue, click **Resume … from part N**. The page does not send the finished parts again, thus you do not pay for them again. Before you click **Resume**, you can change the model, the provider settings or the API key (for example, after you add credits). If you changed the transcript text, the page asks you to confirm, because Resume makes the transcript again.

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

The page keeps your API key, model name, saved models, provider settings and switch settings in the local storage of your browser. The page sends the audio directly to OpenRouter. There is no other server.

## Files

- `index.html`: The page layout. It uses Bootstrap from a CDN.
- `app.js`: The page logic.
