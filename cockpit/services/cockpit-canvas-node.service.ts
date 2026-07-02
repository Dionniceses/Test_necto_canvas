// Handles the creation, positioning, and rendering of visual destination node graphics on the PIXI canvas.
import { Injectable, inject } from '@angular/core';
import { Graphics, BitmapText, Assets } from 'pixi.js';
import {
  CockpitCanvasNode,
  CockpitCanvasNodePosition,
  CockpitCanvasNodePositionResult,
} from '../interfaces/cockpit-canvas-node.interface';
import { AdvancedSettingsService } from './advanced-settings.service';

@Injectable({
  providedIn: 'root',
})
export class CockpitCanvasNodeService {
  // ── Palette (matches cockpit JSX NQ design tokens) ───────────────────────
  readonly #pink = 0xe5247d;
  readonly #text = 0x141a26;
  readonly #border = 0xe6e8ec;
  readonly #dotGreen = 0x1f8a5b;

  readonly #destinationRingCapacity = 10;
  readonly #destinationRingStep = 90;
  readonly #horizontalPadding = 16;
  readonly #verticalPadding = 12;

  readonly #destinationPositions = new Map<string, CockpitCanvasNodePosition>();

  #bitmapFontsLoaded = false;
  #advancedSetting = inject(AdvancedSettingsService);

  async loadBitmapFonts(): Promise<void> {
    if (this.#bitmapFontsLoaded) return;

    try {
      // Load pre-generated bitmap fonts using the Assets API
      await Assets.load('assets/fonts/noto_sans/NototSans-Bold.ttf');
      await Assets.load('assets/fonts/noto_sans/NototSans-SemiBold.ttf');

      this.#bitmapFontsLoaded = true;
    } catch (error) {
      console.error('Failed to load bitmap fonts:', error);
      // Fallback to runtime generation or vector text
    }
  }

  resetDestinationPositions(): void {
    this.#destinationPositions.clear();
  }

  createNeqtoNode(): CockpitCanvasNode {
    const w = 180;
    const h = 88;

    const box = new Graphics();

    box.circle(w / 2, h / 2, h / 2);
    box.fill(0xffffff);
    box.stroke({ color: this.#pink, width: 2 });

    const textLabel = new BitmapText({
      text: 'Neqto',
      style: {
        fontSize: 20,
        align: 'center',
      },
    });

    textLabel.tint = this.#pink;
    textLabel.anchor.set(0.5);

    return { box, label: textLabel, width: w, height: h };
  }

  createNode(label: string, width: number, height: number): CockpitCanvasNode {
    const textLabel = new BitmapText({
      text: label,
      style: {
        fontSize: 14,
        align: 'center',
      },
    });

    textLabel.tint = this.#text;
    textLabel.anchor.set(0.5);

    const textWidth = textLabel.width;
    const textHeight = textLabel.height;
    const calculatedWidth = Math.max(width, textWidth + this.#horizontalPadding);
    const calculatedHeight = Math.max(height, textHeight + this.#verticalPadding);

    const box = new Graphics();

    this.drawDestinationBox(box, calculatedWidth, calculatedHeight, this.#dotGreen, false);

    return {
      box,
      label: textLabel,
      width: calculatedWidth,
      height: calculatedHeight,
      nodeColor: this.#dotGreen,
    };
  }

  /**
   * Draws (or redraws) the pill-shaped background of a destination node,
   * including the coloured status dot. Exposed as public so the canvas
   * component can call it from #redrawDestinationNode without duplicating
   * the draw logic.
   */
  drawDestinationBox(box: Graphics, width: number, height: number, nodeColor: number, isSelected: boolean): void {
    const radius = height / 2;

    box.roundRect(0, 0, width, height, radius);
    box.fill(0xffffff);
    box.stroke({
      color: isSelected ? this.#pink : this.#border,
      width: isSelected ? 1.5 : 1,
    });
  }

  positionNodeInCenter(node: CockpitCanvasNode, hostWidth: number, hostHeight: number): void {
    const centerX = hostWidth / 2;
    const centerY = hostHeight / 2;

    node.box.x = centerX - node.width / 2;
    node.box.y = centerY - node.height / 2;
    node.label.x = centerX;
    node.label.y = centerY;
  }

  positionNode(destination: string, hostWidth: number, hostHeight: number): CockpitCanvasNodePositionResult {
    const destinationKey = destination.trim().toLowerCase();

    if (!destinationKey) {
      return {
        position: {
          x: hostWidth / 2,
          y: hostHeight / 2,
        },
        isNew: false,
      };
    }

    const existingPosition = this.#destinationPositions.get(destinationKey);

    if (existingPosition) {
      return {
        position: existingPosition,
        isNew: false,
      };
    }

    const destinationIndex = this.#destinationPositions.size;
    const slotIndex = destinationIndex % this.#destinationRingCapacity;
    const ringIndex = Math.floor(destinationIndex / this.#destinationRingCapacity);
    const capacity = this.#destinationRingCapacity;
    const slotAngle = (Math.PI * 2) / capacity;

    const baseAngle = (slotIndex / capacity) * Math.PI * 2 - Math.PI / 2;

    // alternating + phased offset (prevents alignment, keeps symmetry)
    const phaseSteps = this.#advancedSetting.boxplacementformula();

    const angleOffset =
      (ringIndex % 2) * (slotAngle / 2) + // interleave every other ring
      (ringIndex % phaseSteps) * (slotAngle / phaseSteps / 2); // subtle variation

    const angle = baseAngle + angleOffset;
    const centerX = hostWidth / 2;
    const centerY = hostHeight / 2;
    const baseRadiusX = (hostWidth / 2) * 0.6;
    const baseRadiusY = (hostHeight / 2) * 0.5;

    const radiusX = baseRadiusX + ringIndex * this.#destinationRingStep;
    const radiusY = baseRadiusY + ringIndex * this.#destinationRingStep;

    const position: CockpitCanvasNodePosition = {
      x: centerX + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY,
    };

    this.#destinationPositions.set(destinationKey, position);

    return {
      position,
      isNew: true,
    };
  }
}
