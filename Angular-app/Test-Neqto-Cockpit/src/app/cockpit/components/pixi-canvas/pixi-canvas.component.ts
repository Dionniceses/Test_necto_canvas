import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, effect } from '@angular/core';
import { Application, Sprite, Ticker, Assets, Text, Graphics, Container, TextStyle } from 'pixi.js';
import { BoxLayoutService } from '../../services/box-layout.service';
import { ZoomPanService } from '../../services/zoom-pan.service';

@Component({
  selector: 'app-pixi-canvas',
  standalone: true,
  templateUrl: './pixi-canvas.component.html',
  styleUrl: './pixi-canvas.component.scss',
})
export class PixiCanvasComponent implements AfterViewInit, OnDestroy {
  @ViewChild('pixiHost', { static: true }) pixiHost!: ElementRef<HTMLDivElement>;

  private pixiApp: Application | null = null;
  private sprites: Sprite[] = [];
  private boxes: Map<string, { sprite: Sprite; centerX: number; centerY: number }> = new Map();
  private worldContainer: Container | null = null;
  private worldWidth = 0;
  private worldHeight = 0;
  private lastHostWidth = 0;
  private readonly boundResize = () => this.handleResize();

  // Layers for rendering order control
  private lineLayer: Container | null = null;
  private boxLayer: Container | null = null;
  private textLayer: Container | null = null;
  private spriteLayer: Container | null = null;

  constructor(
    private boxLayoutService: BoxLayoutService,
    private zoomPanService: ZoomPanService
  ) {
    // Setup zoom/pan effect in constructor (injection context available)
    // Important: Read signals BEFORE null check so Angular tracks dependencies
    effect(() => {
      const state = this.zoomPanService.state();
      
      if (!this.worldContainer) {
        return;
      }
      
      this.worldContainer.position.set(state.panX, state.panY);
      this.worldContainer.scale.set(state.zoomLevel, state.zoomLevel);
    });
  }

  async ngAfterViewInit(): Promise<void> {
    const hostElement = this.pixiHost.nativeElement;

    const app = new Application();
 
    await app.init({
      resizeTo: hostElement,
      backgroundColor: 0xf5f5f5,
      antialias: true
    });

    hostElement.appendChild(app.canvas);
    this.pixiApp = app;

    // Create world container to hold all zoomable/panable content
    this.worldContainer = new Container();
    this.pixiApp.stage.addChild(this.worldContainer);

    // Create layers in rendering order (bottom to top)
    this.lineLayer = new Container();
    this.boxLayer = new Container();
    this.textLayer = new Container();
    this.spriteLayer = new Container();

    this.worldContainer.addChild(this.lineLayer);
    this.worldContainer.addChild(this.boxLayer);
    this.worldContainer.addChild(this.textLayer);
    this.worldContainer.addChild(this.spriteLayer);

    // Get box positions
    const boxPositions = this.boxLayoutService.calculateBoxPositions(
      hostElement.clientWidth,
      hostElement.clientHeight
    );

    // Calculate world dimensions (make it larger to allow panning)
    let maxX = 0, maxY = 0;
    for (const box of boxPositions) {
      maxX = Math.max(maxX, box.x + box.width);
      maxY = Math.max(maxY, box.y + (box.height || box.width));
    }

    // Use the actual Pixi canvas for event handling
    const pixiCanvas = this.pixiApp!.canvas as HTMLCanvasElement;
    
    // Create world dimensions that are larger than viewport to allow panning
    this.worldWidth = Math.max(maxX * 2);
    this.worldHeight = Math.max(maxY * 2);

    // Initialize zoom-pan service with the canvas element and world dimensions
    this.zoomPanService.init(pixiCanvas, this.worldWidth, this.worldHeight);

    // 1. Create boxes (static)
    for (const box of boxPositions) {
      await this.createBox(box);
    }

    // 2. Draw lines between boxes (static)
    this.drawConnectionLines();

    // 3. Create moving sprites (animated)
    await this.createMovingSprite('emendis-footer.png', 50, 50, { vx: 10, vy: 1 }, 1);
    await this.createMovingSprite('logo-neqto.png', 100, 150, { vx: -1, vy: 2 }, 0.1);

    // Setup ticker only for moving sprites
    this.setupTicker();

    // Force an initial render
    this.pixiApp!.renderer.render(this.pixiApp!.stage);

    // Keep internal world width in sync after layout changes (e.g. sidebar toggle).
    this.lastHostWidth = hostElement.clientWidth;
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.boundResize);
    }
  }

  private handleResize(): void {
    if (!this.pixiApp) {
      return;
    }

    const hostElement = this.pixiHost?.nativeElement;
    if (!hostElement) {
      return;
    }

    const currentHostWidth = hostElement.clientWidth;
    if (!currentHostWidth) {
      return;
    }

    this.pixiApp.resize();

    if (currentHostWidth !== this.lastHostWidth) {
      this.lastHostWidth = currentHostWidth;

      // Recalculate world bounds from current layout instead of only growing width.
      const boxPositions = this.boxLayoutService.calculateBoxPositions(
        currentHostWidth,
        hostElement.clientHeight
      );

      let maxX = 0;
      let maxY = 0;
      for (const box of boxPositions) {
        maxX = Math.max(maxX, box.x + box.width);
        maxY = Math.max(maxY, box.y + (box.height || box.width));
      }

      this.worldWidth = Math.max(maxX * 2);
      this.worldHeight = Math.max(maxY * 2);
      this.zoomPanService.setWorldDimensions(this.worldWidth, this.worldHeight);
    }

    this.zoomPanService.resize();
  }

  private async createBox(box: any): Promise<void> {
    let boxSprite: Sprite | Graphics;
    
    try {
      // Try to load image texture
      const texture = await Assets.load('/assets/images/placeholder.png');
      boxSprite = new Sprite(texture);
      boxSprite.width = box.width;
      boxSprite.height = box.width * 0.8;
    } catch (error) {
      // If image fails, create a simple rectangle
      console.warn(`Failed to load placeholder.png, using rectangle instead`);
      boxSprite = new Graphics();
      boxSprite.rect(0, 0, box.width, box.width * 0.8);
      boxSprite.fill(0xcccccc);
      boxSprite.stroke({ width: 2, color: 0x999999 });
    }
    
    boxSprite.x = box.x;
    boxSprite.y = box.y;
    this.boxLayer!.addChild(boxSprite);

    // Add text label centered on box
    const boxHeight = box.width * 0.8;
    const text = new Text({
      text: box.label,
      style: new TextStyle({
        fontFamily: 'Arial',
        fontSize: 14,
        fill: 0x333333,
        align: 'center'
      })
    });
    text.x = box.x + box.width / 2 - text.width / 2;
    text.y = box.y + boxHeight / 2 - text.height / 2;
    this.textLayer!.addChild(text);

    // Store box center for drawing lines
    const centerX = box.x + box.width / 2;
    const centerY = box.y + boxHeight / 2;
    this.boxes.set(box.label, { sprite: boxSprite as Sprite, centerX, centerY });
  }

  private drawConnectionLines(): void {
    const boxArray = Array.from(this.boxes.values());
    
    // Draw lines from Neqto (center) to other boxes
    if (this.boxes.has('Neqto')) {
      const neqto = this.boxes.get('Neqto')!;
      
      for (const [label, box] of this.boxes) {
        if (label !== 'Neqto') {
          this.drawLine(neqto.centerX, neqto.centerY, box.centerX, box.centerY);
        }
      }
    }
  }

  private drawLine(x1: number, y1: number, x2: number, y2: number): void {
    // Using Pixi Graphics to draw lines
    const line = new Graphics();
    line.moveTo(x1, y1);
    line.lineTo(x2, y2);
    line.stroke({ width: 2, color: 0x999999 });
    this.lineLayer!.addChild(line);
  }

  private async createMovingSprite(
    imagePath: string,
    x: number,
    y: number,
    velocity: { vx: number; vy: number },
    scale: number
  ): Promise<void> {
    let displayObject: Sprite | Graphics;
    
    try {
      const texture = await Assets.load(`/assets/images/${imagePath}`);
      displayObject = new Sprite(texture);
    } catch (error) {
      // If image fails, create a simple colored circle
      displayObject = new Graphics();
      displayObject.circle(0, 0, 15);
      displayObject.fill(0xff6b6b);
    }
    
    displayObject.x = x;
    displayObject.y = y;
    displayObject.scale.set(scale);
    (displayObject as any).vx = velocity.vx;
    (displayObject as any).vy = velocity.vy;
    this.spriteLayer!.addChild(displayObject);
    this.sprites.push(displayObject as Sprite);
  }

  private setupTicker(): void {
    this.pixiApp!.ticker.add((ticker: Ticker) => {
      this.sprites.forEach(sprite => {
        const vx = (sprite as any).vx || 0;
        const vy = (sprite as any).vy || 0;

        // Move sprite by velocity
        sprite.x += vx * ticker.deltaTime;
        sprite.y += vy * ticker.deltaTime;

        // Wrap around when off-screen based on WORLD dimensions (not viewport)
        // This ensures correct wrapping when zoomed/panned
        if (sprite.x > this.worldWidth) {
          sprite.x = -sprite.width;
        }
        if (sprite.x < -sprite.width) {
          sprite.x = this.worldWidth;
        }
        if (sprite.y > this.worldHeight) {
          sprite.y = -sprite.height;
        }
        if (sprite.y < -sprite.height) {
          sprite.y = this.worldHeight;
        }
      });
    });

    // Start the ticker to begin rendering
    this.pixiApp!.ticker.start();
  }
  
  ngOnDestroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.boundResize);
    }
    this.zoomPanService.dispose();
    this.pixiApp?.destroy();
    this.pixiApp = null;
  }
}