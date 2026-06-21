# Images In Chat

Chat Mode can display images found in answers, attached by the user, or linked from web results.

## When To Use It

Use image previews when a task answer includes useful image links, when you attached images, or when you need to inspect, zoom, or compare images from a single answer.

## Quick Steps

1. Ask a task that returns image links or attach an image to the prompt.
2. Wait for the answer bubble to finish.
3. Review inline images or thumbnails under the answer.
4. Click a thumbnail or inline image to open the preview.
5. Zoom, pan, open externally, or move through images from that answer.
6. Close the preview when finished.

## Step-By-Step: Discuss An Earlier Image

1. Open the same thread that contains the image.
2. Write a prompt that clearly refers to the earlier image.
3. Mention which image you mean if there are several.
4. Send the prompt.
5. The app includes relevant image context when the provider supports it.

## Inline Images

When an answer includes image links, the app can show:

- Inline image previews in the answer.
- Thumbnail rows below the answer.
- Site/source icons for links used in the answer.

Image loading depends on the URL being reachable and allowing the app to display it.

Click a thumbnail or inline image to open the preview for images from that answer only.

## Image Preview

Click an image or thumbnail to open the preview.

The preview supports:

- Close.
- Open externally.
- Zoom in and out.
- Reset view.
- Pan/move while zoomed.
- Previous/next image for images from the same answer bubble.

Image navigation is scoped to the answer bubble that produced the images.

## MiniMax And Older Images

Some providers can fail when older image content is resent in later prompts.

For MiniMax, the app avoids resending older image content unless:

- The user attached an image to the current prompt.
- The current prompt is clearly asking about an earlier image in the same thread.

This avoids unnecessary provider failures without making the user manage old image attachments manually.

This cleanup should happen quietly in the background. The chat normally does not need to show a warning when the app starts a fresh provider session to avoid resending old image content.

## Troubleshooting

- If a thumbnail is blank, open the source link externally to check whether the image URL is reachable.
- If the preview cannot close, use the close button in the preview toolbar or press Escape.
- If a provider fails after older images were used, start a fresh task or ask specifically about the current image only.
- If you want MiniMax to use an image, attach it to the current prompt or clearly reference the earlier image.
- If a URL points to an image but the app does not render it, the server may block hotlinking or require browser cookies.

## Related Pages

- [Chat Mode](./chat-mode.md)
- [Saving Answers And Exports](./saving-answers-and-exports.md)
