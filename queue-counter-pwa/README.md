# Queue Counter PWA

A static, installable web app that uses an iPhone/iPad camera and TensorFlow.js COCO-SSD to count visible people.

## What it counts

- It detects visible people in the current camera image.
- By default, you drag a rectangle over the queue. A person is counted when the centre of their detection box is inside that rectangle.
- “Whole camera image” counts every detected person in view.
- It does **not** identify people and does not count unique visitors over time.

## Publish with GitHub Pages

1. Create a new GitHub repository, for example `queue-counter`.
2. Upload every file and folder from this project to the repository root.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, choose:
   - Source: **Deploy from a branch**
   - Branch: **main**
   - Folder: **/(root)**
5. Save, then open the Pages address shown by GitHub:
   `https://YOUR-USERNAME.github.io/queue-counter/`

GitHub Pages serves the site over HTTPS, which is required for browser camera access.

## Add it to an iPhone or iPad Home Screen

1. Open the published URL in Safari.
2. Tap **Share**.
3. Tap **Add to Home Screen**.
4. Keep **Open as Web App** enabled if Safari offers it.
5. Tap **Add**.

## First use

1. Open the Home Screen app.
2. Tap **Start camera**.
3. Allow camera access.
4. Drag on the live image to draw the queue area.
5. Adjust detection confidence if needed.

The first load needs internet access to download the TensorFlow.js libraries and AI model. The service worker caches fetched resources where the browser permits it, but you should test offline behaviour on the exact iOS/iPadOS version you will use.

## Accuracy tips

- Mount the device so the view is stable.
- Avoid severe backlighting.
- Avoid placing people directly behind one another.
- Use a high enough angle to separate heads and bodies.
- Lower confidence if people are missed; increase it if false boxes appear.
- For a long or crowded queue, a custom trained detector or server/native solution will be more accurate.

## Privacy

Inference runs in the browser. This project does not upload camera video or save images. Manual readings are stored in the browser's local storage and can be exported as CSV.

## Important limitation

This version gives a **current visible queue count**. It is not an entry/exit counter and does not track unique people crossing a line. For that feature, add a multi-object tracker and line-crossing logic.


## Version 2 fixes

- The camera area no longer blocks vertical page scrolling while the camera is off.
- The “Camera is off” overlay now reliably disappears when the camera starts.
- The service-worker cache version was increased so deployed updates can replace old files.
