import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-cockpit',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './cockpit.component.html',
  styleUrl: './cockpit.component.scss'
})
export class CockpitComponent {}
