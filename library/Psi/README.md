# Psi

Real-time numerical visualiser of hydrogenic bound-state probability densities. It computes $`|\psi_{n,\ell,m}(r,\theta,\phi)|^2`$ on configurable slice planes using consistent and standardised SI units, reduced-mass Bohr radius scaling, stable log-gamma normalisation for radial functions, and complex spherical harmonics with the Condon–Shortley phase.

* p5.js 2.2.3
* Web Worker (density-grid computation kernel)
* Tweakpane 4.x (parameter interface)
* Lanczos log-gamma approximation

## Model computations

* Normalised radial functions via associated Laguerre recurrence and log-gamma normalisation.

* Complex spherical harmonics via associated Legendre recurrence.
* Stationary-state wavefunction evaluated on $`x-z`$, $`x-y`$, or $`y-z`$ slice planes.
* Probability density with tone-mapped LUT rendering and exposure gamma correction.
* Bisection-refined node detection for radial, polar, and azimuthal nodal surfaces.
* Reduced-mass Bohr radius and electron–nucleus reduced mass for arbitrary nuclear charge $Z$.

---

## Project Files

* [Psi.js — p5.js lifecycle and configuration](Psi.js)
* [core/AppCore.js — State management, worker dispatch, and parameter validation](core/AppCore.js)
* [worker/PsiWorker.js — Density-grid computation kernel (wavefunctions, special functions)](worker/PsiWorker.js)
* [render/Renderer.js — LUT rendering, overlays, legend, and node visualisation](render/Renderer.js)
* [analysis/Analyser.js — Density statistics, radial probability moments, and node detection](analysis/Analyser.js)
* [ui/GUI.js — Tweakpane interface (4 tabs: Sim, Render, Statistics, Media)](ui/GUI.js)
* [ui/InputHandler.js — Keyboard, mouse, and touch input](ui/InputHandler.js)
* [media/Media.js — Parameter/statistics import and export, image/media capture](media/Media.js)

### Folder Structure

```text
Psi/
├─ index.html
├─ Psi.js
├─ core/
│  └─ AppCore.js
├─ render/
│  └─ Renderer.js
├─ ui/
│  ├─ GUI.js
│  └─ InputHandler.js
├─ analysis/
│  └─ Analyser.js
├─ media/
│  └─ Media.js
└─ worker/
    └─ PsiWorker.js
```

---

## Content

### Theoretical Background

* [Quantum Mechanics and the Hydrogen Atom](#1-quantum-mechanics-and-the-hydrogen-atom)
* [The Hydrogenic Wavefunction](#2-the-hydrogenic-wavefunction)
* [Radial Component](#3-radial-component)
* [Angular Component](#4-angular-component)
* [Probability Density and Slice Planes](#5-probability-density-and-slice-planes)
* [Reduced-Mass Correction](#6-reduced-mass-correction)
* [Model Assumptions](#7-model-assumptions)
* [Model Parameters](#8-model-parameters)

### Implementation

* [Architecture](#9-architecture)
* [Controls](#10-controls)
* [References](#references)

---

### 1. Quantum Mechanics and the Hydrogen Atom

The hydrogen atom — one proton and one electron bound by the Coulomb potential — is the simplest atomic system whose Schrödinger equation admits an exact analytical solution. The stationary states are labelled by three quantum numbers:

* Principal quantum number $`n`$ $`(1 \leq n)`$: determines the energy level and the characteristic size of the orbital.
* Azimuthal quantum number $`\ell`$ $`(0 \leq \ell \leq n{-}1)`$: determines the orbital shape and angular momentum magnitude.
* Magnetic quantum number $`m`$ $`(-\ell \leq m \leq \ell)`$: determines the orbital orientation and the angular momentum component along the quantisation axis.

The spin quantum number $m_s$ does not influence the spatial probability distribution for a single-electron atom and is omitted.

The solutions generalise to hydrogenic ions with nuclear charge $`Z`$, where all radial length scales contract by $`Z`$ and energies scale as $`Z^2`$.

---

### 2. The Hydrogenic Wavefunction

The time-independent Schrödinger equation in spherical coordinates $`(r, \theta, \phi)`$ separates into radial and angular parts. The normalised wavefunction is their product:

$$\psi_{n\ell m}(r, \theta, \phi) = R_{n\ell}(r)\; Y_{\ell}^{m}(\theta, \phi)$$

The probability density, which is the probability per unit volume of finding the electron at a given point, is the square modulus:

$$P(r, \theta, \phi) = |\psi_{n\ell m}(r, \theta, \phi)|^2$$

---

### 3. Radial Component

The normalised radial function is:

$$R_{n\ell}(r) = N_R\; e^{-\rho/2}\; \rho^{\ell}\; L_{n-\ell-1}^{\,2\ell+1}(\rho)$$

where $`\rho = 2Zr / (n\, a_\mu)`$ is the scaled radial coordinate and $`a_\mu`$ is the reduced-mass Bohr radius (§6).

#### 3.1 Log-Stable Normalisation

To avoid numerical overflow at high $`n`$, the normalisation constant is computed in log-space:

$$\ln N_R = \tfrac{3}{2} \ln\!\left(\frac{2Z}{n\, a_\mu}\right) + \tfrac{1}{2}\Big[\ln\Gamma(n - \ell) - \ln(2n) - \ln\Gamma(n + \ell + 1)\Big]$$

The log-gamma function uses a Lanczos approximation with 8 coefficients, extended to $`z < 0.5`$ via the reflection formula $`\Gamma(z)\,\Gamma(1-z) = \pi / \sin(\pi z)`$.

#### 3.2 Associated Laguerre Polynomials

$`L_{k}^{\alpha}(x)`$ is evaluated via the forward recurrence relation:

$$L_0^{\alpha} = 1, \qquad L_1^{\alpha} = 1 + \alpha - x$$

$$L_i^{\alpha}(x) = \frac{(2i - 1 + \alpha - x)\, L_{i-1}^{\alpha} - (i - 1 + \alpha)\, L_{i-2}^{\alpha}}{i}$$

for $`i = 2, \ldots, k`$. Non-finite intermediate results are clamped to zero.

#### 3.3 Radial Nodes

The radial wavefunction has $`n - \ell - 1`$ nodes (zero crossings). Their positions are found by bisection on $`L_{n-\ell-1}^{2\ell+1}(\rho)`$ over $`\rho \in [0, \sim 8n^2]`$, refined to a tolerance of $`10^{-12}`$ in 48 iterations.

---

### 4. Angular Component

The angular part is the complex spherical harmonic with the Condon–Shortley phase:

$$Y_{\ell}^{m}(\theta, \phi) = N_Y\; P_{\ell}^{|m|}(\cos\theta)\; e^{im\phi}$$

#### 4.1 Normalisation

$$\ln N_Y = \tfrac{1}{2} \ln\!\left(\frac{2\ell + 1}{4\pi}\right) + \tfrac{1}{2}\Big[\ln\Gamma(\ell - |m| + 1) - \ln\Gamma(\ell + |m| + 1)\Big]$$

#### 4.2 Associated Legendre Polynomials

$`P_\ell^{|m|}(\cos\theta)`$ is evaluated via the standard recurrence:

$$P_{|m|}^{|m|}(x) = (-1)^{|m|} (2|m| - 1)!!\; (1 - x^2)^{|m|/2}$$

$$P_{|m|+1}^{|m|}(x) = x\,(2|m| + 1)\, P_{|m|}^{|m|}(x)$$

$$P_{\ell}^{|m|}(x) = \frac{x(2\ell - 1)\, P_{\ell-1}^{|m|} - (\ell + |m| - 1)\, P_{\ell-2}^{|m|}}{\ell - |m|}$$

for $`\ell = |m| + 2, \ldots, \ell`$.

#### 4.3 Angular and Azimuthal Nodes

The angular wavefunction has $`\ell - |m|`$ polar nodes (zeros of $`P_\ell^{|m|}(\cos\theta)`$ in $`\theta \in (0, \pi)`$) and $`|m|`$ azimuthal nodal planes (zeros of $`\cos(|m|\phi)`$). Node positions are found by bisection and rendered as curves / lines on the slice plane.

> [!NOTE]
> The complex spherical harmonics $`Y_\ell^m`$ are orthonormal with $`\int |Y_\ell^m|^2\, d\Omega = 1`$, and include the Condon–Shortley phase $`(-1)^m`$ in the Associated Legendre polynomial.

---

### 5. Probability Density and Slice Planes

The 3D density field is sampled onto a 2D slice through the atom. Three orthogonal planes are supported:

| Plane | Coordinates | Fixed axis |
| :--: | :--: | :--: |
| $`x–z`$ | $`(x, z)`$ | $`y = y_0`$ |
| $`x–y`$ | $`(x, y)`$ | $`z = z_0`$ |
| $`y–z`$ | $`(y, z)`$ | $`x = x_0`$ |

For each pixel, the Cartesian coordinates are converted to spherical:

$$r = \sqrt{x^2 + y^2 + z^2}, \qquad \cos\theta = \frac{z}{r}, \qquad \phi = \text{atan2}(y, x)$$

The wavefunction is then evaluated and the density $`|\psi|^2`$ stored. The resulting grid is tone-mapped through a 256-entry colour LUT with an exposure-controlled gamma curve:

$$\text{pixel} = \text{LUT}\!\left[\left(\frac{|\psi|^2}{|\psi|^2_{\text{peak}}}\right)^{1/(1 + \text{exposure})}\right]$$

---

### 6. Reduced-Mass Correction

To account for the finite nuclear mass $`M`$, the electron–nucleus reduced mass $`\mu`$ and the effective Bohr radius $`a_\mu`$ are:

$$\mu = \frac{m_e \, M}{m_e + M}, \qquad a_\mu = a_0 \, \frac{m_e}{\mu}$$

where $`m_e = 9.109 \times 10^{-31}\,\text{kg}`$ is the electron mass and $`a_0 = 5.292 \times 10^{-11}\,\text{m}`$ is the standard Bohr radius. Setting $`\mu \to m_e`$ recovers the infinite-nuclear-mass approximation.

For hydrogenic ions with $`Z > 1`$, the nuclear mass $`M`$ must be specified to evaluate $`\mu`$ and $`a_\mu`$. Nuclear mass is adjustable on a logarithmic scale.

---

### 7. Model Assumptions

* Non-relativistic, point-nucleus, Schrödinger Hamiltonian with Coulomb potential.
* No spin–orbit, fine-structure, hyperfine, or external-field corrections.
* $`R_{n\ell}`$ is real-valued; $`Y_\ell^m`$ and $`\psi`$ are complex.
* $`R`$ and $`\psi`$ carry units of $`\text{m}^{-3/2}`$; $`Y_\ell^m`$ and $`Z`$ are dimensionless.
* Cartesian coordinates and $`r`$ are in metres; masses in kilograms.
* Densities $`|\psi|^2`$ are in $`\text{m}^{-3}`$.

---

### 8. Model Parameters

#### 8.1 Quantum State

| Parameter | Symbol | Default | Range | Description |
| :-- | :--: | :--: | :--: | :-- |
| Principal | $`n`$ | 4 | 1–12 | Energy level |
| Azimuthal | $`\ell`$ | 1 | 0–($`n{-}1`$) | Angular momentum / orbital shape |
| Magnetic | $`m`$ | 0 | $`-\ell$ to $+\ell`$ | Orbital orientation |
| Nuclear charge | $`Z`$ | 1 | 1–20 | Proton count |

#### 8.2 Physical Model

| Parameter | Default | Description |
| :-- | :--: | :-- |
| Reduced mass | on | Use electron–nucleus reduced mass |
| Nucleus mass | $`M_p`$ ($`1.673 \times 10^{-27}`$ kg) | Adjustable on log₁₀ scale ($`10^{-30}$ to $10^{-24}`$ kg) |

#### 8.3 Rendering

| Parameter | Default | Range | Description |
| :-- | :--: | :--: | :-- |
| Resolution | 256 | 64–512 | Grid resolution (pixels) |
| Exposure | 0.75 | 0–2 | Gamma exponent for tone mapping |
| Colour map | rocket | All loaded LUTs | Colour lookup table |
| Smoothing | on | Toggle | p5.js antialiasing |
| View radius | 45 $`a_0`$ | 1–256 $`a_0`$ | Spatial extent of the view |
| Slice plane | $`x–z`$ | $`xy`$, $`xz`$, $`yz`$ | Viewing plane through the atom |
| Slice offset | 0 | ±1024 | Fixed-axis offset |

#### 8.4 Overlays

| Overlay | Key | Description |
| :-- | :--: | :-- |
| Statistics | `O` | Quantum numbers, density values, FPS, view parameters |
| Node visualisation | `N` | Radial nodes (blue circles), angular nodes (red curves/lines) |
| Legend | `L` | Colour bar with probability density axis labels in $`\text{m}^{-3}`$ |

---

### 9. Architecture

#### 9.1 Worker Pipeline

All wavefunction computation runs in a dedicated Web Worker. The main thread posts a render request containing quantum numbers, view parameters, and an `ArrayBuffer`; the worker evaluates the density at each grid point and returns the buffer with ownership:

```mermaid
---
title: Main-Worker Render Process
---
flowchart LR
    Main["Main"] 
    Worker["Worker"]
    Call["render(n,l,m,Z,…,buf)"]
    Loop["for each pixel"]
    Coord["(x,y,z) → (r,θ,φ)"]
    Compute["R_nl(r) · Y_lm(θ,φ) → |ψ|²"]
    Peak["track peak density"]
    Return["result(buf, peak, a_μ)"]

    Main --> Call
    Call --> Worker
    Worker --> Loop
    Loop --> Coord
    Coord --> Compute
    Compute --> Peak
    Peak --> Return
    Return --> Main
```

The worker caches normalisation constants by a hash of $`(n, \ell, m, Z, M)`$ so that panning and zooming (which change only view parameters) reuse the cached values.

#### 9.2 Node Detection

The Analyser detects three types of nodal surfaces:

| Type | Count | Method |
| :-- | :--: | :-- |
| Radial | $`n - \ell - 1`$ | Bisection on $`L_{n-\ell-1}^{2\ell+1}(\rho)`$ over 4096 samples |
| Polar | $`\ell - \lvert m \rvert`$ | Bisection on $`P_\ell^{\lvert m \rvert}(\cos\theta)`$ over 2048 samples |
| Azimuthal | $`\lvert m \rvert`$ | Analytic: $`\phi_k = (k + \tfrac{1}{2})\pi / \lvert m \rvert`$ |

The total node count is $`n - 1`$.

Detected nodes are rendered on the slice plane as:

* Radial nodes: blue circles (projected for off-plane slices).
* Polar nodes: red curves (hyperbolas or circles depending on slice plane).
* Azimuthal nodes: red diametral lines through the origin.

#### 9.3 Statistics

| Metric | Unit | Description |
| :-- | :--: | :-- |
| Density | $`\text{m}^{-3}`$ | Current peak $`\lvert\psi\rvert^2`$ on the grid |
| Mean | $`\text{m}^{-3}`$ | Average density across the grid |
| Std dev | $`\text{m}^{-3}`$ | Standard deviation of density |
| Entropy | — | Shannon entropy of the normalised density distribution |
| Concentration | — | Rényi entropy of order 2 ($`\sum p_i^2`$) |
| Radial peak | $`a_0`$ | Mode of the radial probability distribution $`r^2 \lvert R_{n\ell}\rvert^2`$ |
| Radial spread | $`a_0`$ | Standard deviation in radial space |
| Node estimate | — | Total detected nodal surfaces |

#### 9.4 Orbital Notation

The GUI additionally displays spectroscopic notation derived from the quantum numbers:

$$\ell = 0 \to s, \quad \ell = 1 \to p, \quad \ell = 2 \to d, \quad \ell = 3 \to f, \quad \ell \geq 4 \to g, h, \ldots$$

Format: $n`\ell_m`$, e.g. $`4p_0`$, $`3d_{-1}`$.

---

### 10. Controls

#### 10.1 Quantum State

| Key | Action |
| :-- | :-- |
| `W` / `S` | $`n`$ ±1 |
| `D` / `A` | $`\ell`$ ±1 |
| `E` / `Q` | $`m`$ ±1 |
| `R` / `T` | $`Z`$ ±1 |
| `P` | Toggle reduced mass |
| `G` / `B` | log₁₀($`M`$) ±0.01 |

> [!NOTE]
> Quantum numbers are always automatically clamped to their valid ranges after each adjustment: $`1 \leq n \leq 12`$, $`0 \leq \ell \leq n{-}1`$, $`-\ell \leq m \leq \ell`$.

#### 10.2 View

| Key | Action |
| :-- | :-- |
| `←` / `→` | Slice offset ±0.5 |
| `↑` / `↓` | Zoom (view radius ×0.98 / ×1.02) |
| `Shift+←/→/↑/↓` | Pan in-plane |
| `1` / `2` / `3` | Switch slice plane ($`xy`$ / $`xz`$ / $`yz`$) |
| `Z` | Reset view radius |
| `X` | Reset view centre |
| `Space` | Reset slice offset |

#### 10.3 Rendering

| Key | Action |
| :-- | :-- |
| `C` | Cycle colour map |
| `[` / `]` | Exposure ±0.01 |
| `+` / `-` | Resolution ±2 |
| `M` | Toggle smoothing |
| `O` / `N` / `L` | Toggle overlays (statistics / nodes / legend) |

#### 10.4 Import / Export

| Key | Action |
| :-- | :-- |
| `F` | Export image |
| `V` | Start / stop recording |
| `Shift+I` | Import parameters (JSON) |
| `Shift+P` | Export parameters (JSON) |
| `Shift+S` | Export statistics (JSON) |
| `Shift+C` | Export statistics (CSV) |
| `H` | Toggle GUI panel |
| `#` | Toggle keymap reference overlay |

---

### References

* Griffiths, D.J. (2018) *Introduction to Quantum Mechanics*. 3rd edn. Cambridge: Cambridge University Press.
* Atkins, P.W. and Friedman, R.S. (2011) *Molecular Quantum Mechanics*. 5th edn. Oxford: Oxford University Press.
* Bransden, B.H. and Joachain, C.J. (2003) *Quantum Mechanics*. 2nd edn. Harlow: Pearson Education.
* Zettili, N. (2009) *Quantum Mechanics: Concepts and Applications*. 2nd edn. Chichester: John Wiley & Sons.
* Bethe, H.A. and Salpeter, E.E. (1957) *Quantum Mechanics of One- and Two-Electron Atoms*. Berlin: Springer.

---

### Run

```bash
cd library/Psi
python3 -m http.server 8080
```

Open `http://localhost:8080`.
