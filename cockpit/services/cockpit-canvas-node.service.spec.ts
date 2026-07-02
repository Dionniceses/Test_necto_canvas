import { TestBed } from '@angular/core/testing';
import { CockpitCanvasNodeService } from './cockpit-canvas-node.service';

describe('CockpitCanvasNodeService', () => {
  let service: CockpitCanvasNodeService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CockpitCanvasNodeService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should create the default Neqto center node', () => {
    const node = service.createNeqtoNode();

    expect(node.width).toBe(180);
    expect(node.height).toBe(88);
    expect(node.label.text).toBe('Neqto');
    expect(node.label.anchor.x).toBe(0.5);
    expect(node.label.anchor.y).toBe(0.5);
  });

  it('should create a custom node with provided dimensions and label', () => {
    const node = service.createNode('Destination', 140, 52);

    expect(node.width).toBe(140);
    expect(node.height).toBe(52);
    expect(node.label.text).toBe('Destination');
  });

  it('should position nodes in the center of the host area', () => {
    const node = service.createNode('Center', 120, 60);

    service.positionNodeInCenter(node, 1000, 600);

    expect(node.box.x).toBe(440);
    expect(node.box.y).toBe(270);
    expect(node.label.x).toBe(500);
    expect(node.label.y).toBe(300);
  });

  it('should assign a new destination position once', () => {
    const result = service.positionNode('bol.com', 1200, 800);

    expect(result.isNew).toBeTrue();
    expect(result.position.x).toBeCloseTo(600, 5);
    expect(result.position.y).toBeCloseTo(200, 5);
  });

  it('should ignore duplicate destinations and reuse the same position', () => {
    const first = service.positionNode('bol.com', 1200, 800);
    const second = service.positionNode('bol.com', 1200, 800);

    expect(first.isNew).toBeTrue();
    expect(second.isNew).toBeFalse();
    expect(second.position.x).toBe(first.position.x);
    expect(second.position.y).toBe(first.position.y);
  });

  it('should treat destination keys case-insensitively', () => {
    service.positionNode('Bol.Com', 1200, 800);
    const duplicate = service.positionNode('bol.com', 1200, 800);

    expect(duplicate.isNew).toBeFalse();
  });

  it('should return not-new for empty destination values', () => {
    const result = service.positionNode('   ', 1200, 800);

    expect(result.isNew).toBeFalse();
    expect(result.position.x).toBe(600);
    expect(result.position.y).toBe(400);
  });

  it('should assign different positions for different destinations', () => {
    const first = service.positionNode('bol.com', 1200, 800);
    const second = service.positionNode('google.com', 1200, 800);

    expect(first.isNew).toBeTrue();
    expect(second.isNew).toBeTrue();
    expect(second.position.x).not.toBe(first.position.x);
    expect(second.position.y).not.toBe(first.position.y);
  });

  it('should clear cached destination positions after reset', () => {
    service.positionNode('bol.com', 1200, 800);
    service.resetDestinationPositions();

    const afterReset = service.positionNode('bol.com', 1200, 800);

    expect(afterReset.isNew).toBeTrue();
  });
});
