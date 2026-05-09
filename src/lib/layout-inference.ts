/**
 * Layout auto-inference — V9.1 (compose simplification).
 *
 * Substitui o seletor manual RETRATO/PAISAGEM/TEXTO no ComposeOverlay por
 * inferência determinística baseada em (a) presença de imagem e (b)
 * aspect ratio da mídia, alinhado a Twitter/Threads/Bluesky.
 *
 * **Determinismo (manifesto §7):** função pura, mesmo input → mesmo
 * output. NÃO consulta `Date.now()`, network, nem prefs locais.
 *
 * **Wire format inalterado:** `Subpost.layout` continua sendo um dos 3
 * valores de `LAYOUT_VALUES`; só muda quem decide o valor (antes user,
 * agora client). Posts antigos com layout explícito renderizam idêntico.
 *
 * **Algoritmo:**
 *   1. sem imagem → 'text' (decorative letter, body editorial)
 *   2. imagem com `meta.dim` válido → ratio = w/h
 *      - ratio < 1.2 → 'portrait' (square + slight portrait)
 *      - ratio ≥ 1.2 → 'landscape'
 *   3. imagem sem `meta.dim` (ou malformado) → fallback 'landscape'
 *      (renderiza imagem natural sem crop forçado)
 *
 * Threshold 1.2 escolhido pra absorver "square" (ratio 1.0) e "slight
 * portrait" (ratio até ~1.2 ainda lê como vertical num feed mobile).
 * Acima disso o usuário tipicamente quer ver a imagem em landscape.
 */

import type { LayoutKind } from '../types/drift'
import type { BlobMeta } from './nip94'

/** Threshold w/h pra distinguir portrait/landscape. Square (1.0) cai em portrait. */
const PORTRAIT_RATIO_THRESHOLD = 1.2

/**
 * Parseia `meta.dim` (`"WxH"` per NIP-94) em [w, h] de números finitos
 * positivos. Retorna `null` se ausente/malformado/zero.
 */
function parseDim(dim: string | undefined): [number, number] | null {
  if (!dim) return null
  const parts = dim.split('x')
  if (parts.length !== 2) return null
  const w = Number(parts[0])
  const h = Number(parts[1])
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null
  if (w <= 0 || h <= 0) return null
  return [w, h]
}

/**
 * Infere `LayoutKind` a partir do conteúdo do subpost. Pure function.
 *
 * @param _text   texto do subpost (não usado hoje, reservado pra futuro
 *                — ex.: heuristic "texto longo + imagem pequena" → text).
 *                Prefixed `_` pra manter assinatura estável sem warning.
 * @param imageUrl URL da imagem; `null` se subpost só-texto.
 * @param imageMeta NIP-94 BlobMeta com `dim`. Quando ausente, fallback.
 */
export function inferLayout(
  _text: string,
  imageUrl: string | null,
  imageMeta?: BlobMeta | null,
): LayoutKind {
  if (!imageUrl) return 'text'
  const dim = parseDim(imageMeta?.dim)
  if (dim) {
    const [w, h] = dim
    return w / h < PORTRAIT_RATIO_THRESHOLD ? 'portrait' : 'landscape'
  }
  return 'landscape'
}
