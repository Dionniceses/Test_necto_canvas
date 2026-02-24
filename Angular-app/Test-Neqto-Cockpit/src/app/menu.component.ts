import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-menu',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div style="
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      background: #0a0a0a;
      color: white;
      font-family: monospace;
    ">
      <div style="
        text-align: center;
        background: rgba(0,0,0,0.7);
        padding: 40px;
        border-radius: 8px;
        border: 2px solid #333;
      ">
        <h1 style="margin-bottom: 30px; font-size: 24px;">Renderer Comparison</h1>
        <div style="display: flex; gap: 20px;">
          <a
            routerLink="/webgl"
            style="
              padding: 16px 32px;
              background: #3b82f6;
              color: white;
              text-decoration: none;
              border-radius: 4px;
              border: none;
              font-size: 16px;
              cursor: pointer;
              transition: background 0.2s;
            "
            (mouseenter)="setHover($event, '#2563eb')"
            (mouseleave)="setHover($event, '#3b82f6')"
          >
            WebGL
          </a>
          <a
            routerLink="/canvas2d"
            style="
              padding: 16px 32px;
              background: #ef4444;
              color: white;
              text-decoration: none;
              border-radius: 4px;
              border: none;
              font-size: 16px;
              cursor: pointer;
              transition: background 0.2s;
            "
            (mouseenter)="setHover($event, '#dc2626')"
            (mouseleave)="setHover($event, '#ef4444')"
          >
            Canvas 2D
          </a>
          <a
            routerLink="/pixi"
            style="
              padding: 16px 32px;
              background: #22c55e;
              color: white;
              text-decoration: none;
              border-radius: 4px;
              border: none;
              font-size: 16px;
              cursor: pointer;
              transition: background 0.2s;
            "
            (mouseenter)="setHover($event, '#16a34a')"
            (mouseleave)="setHover($event, '#22c55e')"
          >
            PixiJS
          </a>
        </div>
      </div>
    </div>
  `,
})
export class MenuComponent {
  setHover(event: Event, color: string): void {
    const target = event.target as HTMLElement;
    if (target) target.style.background = color;
  }
}
