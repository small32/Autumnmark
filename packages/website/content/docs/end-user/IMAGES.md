# Image support

By default, MarkText embeds inserted images in the Markdown file. You can change this in **Preferences → Images & Export**. Existing saved preferences continue to apply.

### Upload to cloud using selected uploader

Please see [here](IMAGE_UPLOADER_CONFIGRATION.md) for more information.

### Move to designated local folder

With `imageInsertAction=folder`, inserted local image files and binary images are copied into the configured directory. Remote URLs are kept as URLs. The destination can be relative for saved documents.

**Prefer relative assets folder:**

Enable this option to use a relative destination for local copies associated with a saved document. Choose `imageRelativeDirectoryBase=file` to anchor the directory next to the document or `folder` to anchor it at its project root. You can specify the path via the _relative image folder name_ text box and include variables like `${filename}` to add the file name to the relative directory. For unsaved documents, copies use the configured global image folder instead. If the folder base is selected but no matching project root contains the file, MarkText falls back to the document directory. `${filename}` expands to the document name without its extension.

Note: The assets directory name must be a valid path name and MarkText need write access to the directory.

Examples for relative paths:

- `assets`
- `../assets`
- `.`: current file directory
- `assets/123`
- `assets_${filename}` (add the document file name)

### Keep original location

Existing path strings are kept unchanged. Binary images, including pasted clipboard images, are written to the configured image folder; a saved document can use its configured relative image folder.

### Embed in Markdown (Base64)

In this mode, inserting a local image or a screenshot stores its bytes as a data URL. Inserting a web image downloads and embeds it so the document can display it offline.

Pasting Markdown such as `![map](images/map.png)` or `<img src="images/map.png" width="240">` also embeds the images in both editing modes. Relative paths use the folder of the Markdown file you are editing. You can continue typing while web images download. Longer pastes show an image count in the bottom corner. If an image cannot be read, its original link stays in the document.

Embedded pictures have a small document badge in the upper-right corner. To embed existing pictures, right-click one linked picture and choose **Embed this image**, or right-click the document background and choose **Embed all document images**. You can also start a batch conversion from the image count in the bottom-right corner.

To convert media across a saved Markdown file or folder, right-click it in the sidebar and choose a batch media action. Select the available image and video types to convert. The dialog shows how many items it found before you apply the conversion.

Hover over a picture in the visual editor and drag either side handle. The readout shows the display width and height in pixels. Hold **Shift** near another picture's width or height on the same row to match it. For exact dimensions, right-click an embedded picture and choose **Set image size…**. Enter the width and height, choose whether to lock the aspect ratio, then apply. **Restore automatic size** clears the explicit dimensions when applied.

By default, compact mode limits code blocks to 12 lines. Set a positive image height to limit the preview height of a tall picture in its own paragraph. Expand it to see the whole picture. Pictures on the same row keep their individual sizes. In the editor preferences, enter **0** for the image height, video height, or code line limit to disable compact mode for that type.

Click an embedded image to open **Image preview**. Scroll to zoom, drag the image to pan at any zoom level, or select **Fit to window**. Drop or paste an image into the preview to replace it. The **Embedded source** tab lets you copy or edit the data URL. Select **Apply changes** to update the image. Each replacement can be undone, including after the preview closes.

Right-click the image in either editor to copy it as PNG, JPEG, or a data URL. **Save image as…** exports a copy. **Convert to local image** writes the original bytes into the configured relative assets folder and updates the document reference. Undo restores the embedded reference and keeps the saved file.

Drag an image from the document into a file manager or an application that accepts dropped files. In the preview, **Drag original out** works at any zoom level. The exported file retains the original format.

## Video files

Use **Format → Insert video…**, drop a video file into the editor, or paste one from the clipboard. By default the document references the video file. If the clipboard supplies only video data or a temporary copy, choose where to save it so the reference continues to work. Enable **Preferences → Video → Embed videos as Base64** to store new videos inside the Markdown file. This setting applies independently of the image setting.

Hover over a video in the editor to play, pause, seek, or enter fullscreen. In compact mode, **Maximum video height (px)** scales the player proportionally. The default is 0, which shows videos at their normal size.

Click the filename beneath the player to open the preview. The source tab lets you edit Base64 for smaller embedded videos. Right-click to copy the video as a file, save it in its original format, replace it, or switch between an embedded video and a local file reference. Drag the filename, or use **Drag original video out** in the preview, to drop a copy into another application. Playback depends on the codec available in the desktop player.

For local videos of 32 MiB or more, the editor streams the original bytes into the Markdown file when you save. You can move the Markdown file alone and reopen it in AutumnMark+. The source tab shows the video size for these attachments. Use **Replace** to change the video.

## Media viewer

In the WYSIWYG editor, Command-click an image on macOS or Ctrl-click it on Windows to open the media viewer. The image preview action also opens this viewer. Rendered diagrams also have a **View** action in their hover toolbar. Use the mouse wheel or the zoom buttons to zoom, and drag to pan.

The viewer supports <kbd>+</kbd>/<kbd>-</kbd> for zoom, <kbd>0</kbd> to fit, <kbd>1</kbd> for actual size, arrow keys to pan, and <kbd>Esc</kbd> to close. Diagram controls offer PNG export and, when available, SVG export, plus copying as a PNG. Available actions depend on the content being viewed.

PlantUML diagrams use the server configured by `plantumlServer` in Preferences → Markdown. The default is `https://www.plantuml.com/plantuml`; choose your own HTTP(S) endpoint to use another server. Rendering sends the encoded diagram source to the selected server.
