# Approved FloFi identity

Source: owner-approved `/mnt/c/Users/ASUS/Desktop/WORLD/tokensandlogo.zip`
(SHA-256 `e42082c13345c8ef6b4ee62b34157e3f8767aea8dd56a5620dd04e8a1a3b8cba`).
Only the four supplied identity assets were copied; no reference HTML or runtime was imported.

| Product asset | Package asset |
| --- | --- |
| `flofi-symbol-light.svg` | `assets/2edaac5d207cd190feac7f3a3f18cee6.svg` |
| `flofi-symbol-dark.svg` | `assets/fb842e26e70eab9f94a1f4a4124ddfde.svg` |
| `flofi-wordmark-light.png` | `assets/5b8057003dfcc4bce6ae4f4649ff27eb.png` |
| `flofi-wordmark-dark.png` | `assets/7c2ae5848c1ebed05a31b631da20303b.png` |

These files retain the source bytes, aspect ratios and colors. The SVG symbols use
blue `#2343D9` or white bands, a `#C9D2F8` droplet and the supplied navy face.
The transparent 738×280 PNG wordmarks use navy `#041B3D` or white.

`src/app/icon.svg` places the exact white symbol paths on a `#2343D9` square,
using Next's existing app-icon file convention. No raster conversion is involved.
The package does not supply a vector wordmark, ICO, or Apple touch icon.

Typography uses Next's Google font loader: Outfit 400/500/600 and IBM Plex Mono
400/500. Fonts are self-hosted by Next; no manually copied font binaries or
browser requests to Google are required. The package's wider color-system and
mascot recommendations are outside this adjustment.
