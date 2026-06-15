import { Injectable } from '@angular/core';
import { Graphics, Text } from 'pixi.js';
import {
  CockpitCanvasNode,
  CockpitCanvasNodePosition,
  CockpitCanvasNodePositionResult,
} from '../interfaces/cockpit-canvas-node.interface';

@Injectable({
  providedIn: 'root',
})
export class CockpitCanvasNodeService {
  readonly #primaryColor = 0xdd0053;
  readonly #secondaryColor = 0x2d213a;
  readonly #destinationRingCapacity = 10;
  readonly #destinationRingStep = 90;
  readonly #horizontalPadding = 16;
  readonly #verticalPadding = 12;

  readonly #destinationPositions = new Map<string, CockpitCanvasNodePosition>();

  resetDestinationPositions(): void {
    this.#destinationPositions.clear();
  }

  createNeqtoNode(): CockpitCanvasNode {
    return this.createNode('Neqto', 90, 44);
  }

  createNode(label: string, width: number, height: number): CockpitCanvasNode {
    const textLabel = new Text({
      text: label,
      style: {
        fill: label === 'Neqto' ? this.#primaryColor : this.#secondaryColor,
        fontSize: 17,
        fontWeight: '700',
      },
    });

    textLabel.anchor.set(0.5);

    // Measure text and calculate final node dimensions with padding
    const textWidth = textLabel.width;
    const textHeight = textLabel.height;
    const calculatedWidth = Math.max(width, textWidth + this.#horizontalPadding);
    const calculatedHeight = Math.max(height, textHeight + this.#verticalPadding);

    const box = new Graphics();

    box.roundRect(0, 0, calculatedWidth, calculatedHeight, 14);
    box.fill(0xffffff);
    box.stroke({ color: label === 'Neqto' ? this.#primaryColor : this.#secondaryColor, width: 3 });

    return {
      box,
      label: textLabel,
      width: calculatedWidth,
      height: calculatedHeight,
    };
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
    const phaseSteps = 6;

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
