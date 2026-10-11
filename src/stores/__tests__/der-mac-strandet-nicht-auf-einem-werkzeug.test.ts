/**
 * Auf einem Mac darf der Backend-Schalter kein Werkzeug stehen lassen, das
 * die Werkzeugleiste dort gar nicht zeigt.
 *
 * Gefunden am 04.09.2026 in der Gegenpruefung des Drehrads, und zwar an der
 * Wirkung: `intents.findIndex` lieferte -1, die ganze Create-Leiste stand auf
 * dem Boden der Deckkraft und die Spur sprang an den linken Anschlag. Das sah
 * aus wie ein Ladefehler, war aber nur eine Auswahl, die es nicht mehr gab.
 *
 * Die Ursache lag eine Etage tiefer. Auf einem Mac laeuft lokal MLX, nicht
 * ComfyUI, und MLX kann weder Edit noch Cutout noch Animate; `visibleIntents`
 * blendet die drei deshalb aus. `setBackend('local')` raeumte aber nur
 * `utilityOp` und die nicht-lokalen `cloudOp` ab, nicht `removebg`,
 * `imageSubMode` und `videoSubMode`, aus denen genau diese drei abgeleitet
 * werden. Erreichbar ohne einen einzigen Klick in der Leiste.
 *
 * Der Fall unten bindet die beiden Module aneinander, ohne dass eines das
 * andere importieren muesste: was `visibleIntents` auf einem Mac versteckt,
 * darf `deriveIntent` nach dem Umschalten nicht mehr liefern. Kommt ein
 * viertes verstecktes Werkzeug dazu, faellt dieser Fall von selbst.
 *
 * Run: npx vitest run src/stores/__tests__/der-mac-strandet-nicht-auf-einem-werkzeug.test.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../api/mlx-image', () => ({ isMlxImageHost: () => true, MLX_MODEL_PREFIX: 'MLX ' }))

import { useCreateStore, deriveIntent } from '../createStore'
import { visibleIntents, isIntentLocked, isIntentAvailable } from '../../components/create/experimental/intents'
import type { CreateIntent } from '../createStore'

const sichtbar = () => new Set(visibleIntents('local', true, true).map((m) => m.id))
const jetzt = () => deriveIntent(useCreateStore.getState())

describe('der Mac strandet nicht auf einem Werkzeug, das er lokal nicht hat', () => {
  beforeEach(() => {
    useCreateStore.setState({ backend: 'cloud' })
    useCreateStore.getState().setIntent('image')
  })

  it('drei Werkzeuge sind lokal auf dem Mac wirklich versteckt', () => {
    // Ohne diesen Fall koennte der Rest gruen sein, weil gar nichts versteckt
    // ist. Genau das waere die stille Fassung des Fehlers.
    const alle = new Set(visibleIntents('cloud', true, true).map((m) => m.id))
    const fehlend = [...alle].filter((id) => !sichtbar().has(id))
    expect(fehlend.sort()).toEqual(['animate', 'edit', 'removebg'])
  })

  it('keins davon ueberlebt den Wechsel auf lokal', () => {
    for (const versteckt of ['edit', 'removebg', 'animate'] as CreateIntent[]) {
      useCreateStore.setState({ backend: 'cloud' })
      useCreateStore.getState().setIntent(versteckt)
      expect(jetzt(), `${versteckt} war nicht gewaehlt`).toBe(versteckt)
      useCreateStore.getState().setBackend('local')
      expect(sichtbar().has(jetzt()), `${versteckt} steht nach dem Umschalten noch da`).toBe(true)
    }
  })

  it('und die Leiste findet ihren eigenen Eintrag wieder', () => {
    // Die Wirkung, nicht nur die Ursache: -1 war das, was man gesehen hat.
    useCreateStore.setState({ backend: 'cloud' })
    useCreateStore.getState().setIntent('removebg')
    useCreateStore.getState().setBackend('local')
    const liste = visibleIntents('local', true, true)
    expect(liste.findIndex((m) => m.id === jetzt())).toBeGreaterThan(-1)
  })

  it('eine ComfyUI-Bahn bleibt auf dem Mac nicht stehen: sie ist dort ein gesperrter Cloud-Hinweis', () => {
    // Bis zum 09.10.2026 stand hier das Gegenteil: Music, Lipsync, Extend,
    // Motion und Character "laufen lokal" und blieben gewaehlt. Das gilt fuer
    // ComfyUI. Auf einem Mac sind genau diese fuenf lokal gesperrt
    // (`isIntentLocked`), und der Personen-Durchlauf fand die Wirkung: Cloud
    // an, Music geoeffnet, Cloud aus, und Create zeigte den lokalen
    // Music-Composer mit leerer Modellwahl und ohne gewaehlten Reiter.
    const gesperrt = visibleIntents('local', true, true).filter((m) => isIntentLocked(m, 'local', true)).map((m) => m.id)
    for (const bahn of ['music', 'lipsync', 'extend', 'motion', 'character'] as CreateIntent[]) {
      expect(gesperrt, `${bahn} ist auf dem Mac lokal nicht gesperrt`).toContain(bahn)
      useCreateStore.setState({ backend: 'cloud' })
      useCreateStore.getState().setIntent(bahn)
      expect(jetzt(), `${bahn} war nicht gewaehlt`).toBe(bahn)
      useCreateStore.getState().setBackend('local')
      expect(useCreateStore.getState().cloudOp, `${bahn} steht nach dem Umschalten noch da`).toBeNull()
      expect(isIntentAvailable(jetzt(), 'local', true), `${jetzt()} ist nach ${bahn} kein lokaler Reiter`).toBe(true)
    }
  })

  it('und die Werte der Bahn gehen nicht mit: die 50 Schritte von Music landen nicht beim Bildmodell', () => {
    // Die erste Fassung der Korrektur nahm nur den `cloudOp` weg. Im Browser
    // ging danach `mlx_generate` mit steps 50 an SD Turbo, ein Modell fuer
    // vier Schritte. Der Mac verlaesst die Bahn deshalb wie ein Klick auf
    // Image (`setIntent`), und der stellt die Werte der Bildbahn wieder her.
    useCreateStore.setState({ backend: 'cloud' })
    useCreateStore.getState().setIntent('image')
    useCreateStore.setState({ steps: 4 })
    useCreateStore.getState().setIntent('music')
    expect(useCreateStore.getState().steps, 'Music hat seine eigenen Schritte nicht gesetzt').toBe(50)
    useCreateStore.getState().setBackend('local')
    expect(jetzt()).toBe('image')
    expect(useCreateStore.getState().steps).toBe(4)
  })

  it('eine Video-Bahn faellt auf Video zurueck, nicht auf Image', () => {
    useCreateStore.setState({ backend: 'cloud' })
    useCreateStore.getState().setIntent('extend')
    useCreateStore.getState().setBackend('local')
    expect(jetzt()).toBe('video')
  })

  it('ein hosted-only Werkzeug faellt weiter weg, wie bisher', () => {
    // Negativkontrolle gegen einen zu breiten Griff: Upscale und Eraser haben
    // keine lokale Bahn und mussten schon vorher weichen.
    useCreateStore.setState({ backend: 'cloud' })
    useCreateStore.getState().setIntent('upscale')
    useCreateStore.getState().setBackend('local')
    expect(jetzt()).not.toBe('upscale')
    expect(sichtbar().has(jetzt())).toBe(true)
  })
})
