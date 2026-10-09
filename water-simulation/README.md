# Pelagic

An open-ocean simulation running on WebGL 2. A four-band JONSWAP wave spectrum is solved on the GPU with an inverse FFT. Atmosphere, clouds, water reflection, foam and sun glitter are computed in real time. It has a boat camera, sea-state presets, screenshots and a fullscreen mode.

The simulation engine in this version was adapted into the project from the user-provided `su/index.html` reference. It is based on the reference's algorithms and shader code; there are no external libraries or downloaded images.

## Running

```powershell
npm start
```

Open `http://localhost:5173` in the browser. The server runs on Node.js; an up-to-date browser with WebGL 2 and `EXT_color_buffer_float` support is required.

## Sharing with a friend

Send the `Pelagic-Okyanus-Paylasim.zip` file. Your friend can unzip it and double-click the `Pelagic-Okyanus.html` file inside. No internet, Node.js or installation is needed.

If the sources change, regenerate the HTML with `npm run build:share` and update the ZIP.

## Controls

- **Drag:** Rotate the camera.
- **W A S D:** Move. **Q / E:** Descend / ascend. **Shift:** Speed up.
- **Wheel:** Change the field of view.
- **B:** Boat camera. **P:** Pause. **H:** Settings panel. **F:** Fullscreen.
- The panel has wind, wave, sun, cloud, haze and display settings.

This is a visual spectral ocean model; it is not meant for measurement or hydrodynamic validation.
