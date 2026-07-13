# sci-library <img src="logo.png" alt="sci-library logo" align="right" width="175">

A specialised and niche repository of interactive scientific applications constructed using JavaScript.

* p5.js 2.2.3
* Tweakpane 4.x (GUI framework)
* Web Workers (parallel computation)
* WebGL / GLSL (3D rendering pipeline)

Live instance: <https://sci-library.onrender.com/> (will wind down)

---

### 1. Running Locally

#### 1.1 Podman + Caddy (recommended)

```bash
git clone https://github.com/eanutt1272v2/sci-library.git
cd sci-library
podman compose up -d --build
```

Open `http://localhost:8080` and navigate to `library/<App_Name>/`.

> [!TIP]
> If your Podman installation does not include the Compose plugin, use `podman-compose up -d --build` instead.

#### 1.2 Single sketch via static server

```bash
cd library/Psi
python3 -m http.server 8080
```

Open `http://localhost:8080`.

> [!NOTE]
> Some sketches using `SharedArrayBuffer` or advanced Worker features require cross-origin isolation headers (`Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy`). The Podman + Caddy setup applies these headers automatically, however, a bare static server may not.

---

## Licence

This repository is released under the [MIT Licence](LICENSE).

You are free to use, copy, modify, merge, publish, distribute, sublicense,
and sell copies of the scripts, provided the original copyright notice and
this licence notice are retained in all copies or substantial portions of the
software.

See the [LICENSE](LICENSE) file in the repository root for the complete licence text.
