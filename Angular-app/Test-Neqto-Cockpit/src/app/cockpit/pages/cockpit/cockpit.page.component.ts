import { Component, computed, signal, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { DatePicker } from 'primeng/datepicker';
import { PixiCanvasComponent } from '../../components/pixi-canvas/pixi-canvas.component';
import { ZoomPanService } from '../../services/zoom-pan.service';

@Component({
  selector: 'app-cockpit-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, DatePicker, PixiCanvasComponent],
  templateUrl: './cockpit.page.component.html',
  styleUrl: './cockpit.page.component.scss',
  providers: [ZoomPanService]
})
export class CockpitPageComponent {
  @ViewChild(PixiCanvasComponent) pixiCanvas!: PixiCanvasComponent;

  selectedDate = new FormControl<Date | null>(new Date());
  selectedDateSignal = signal<Date | null>(new Date());
  maxDate = new Date(); // Vandaag is het maximum

  minDate = computed(() => {
    const thirtyDaysAgo = new Date(this.maxDate);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return thirtyDaysAgo;
  });

  isPreviousDayDisabled = computed(() => {
    const selected = this.selectedDateSignal();
    if (!selected) return false;
    
    const previousDay = new Date(selected);
    previousDay.setDate(previousDay.getDate() - 1);
    
    const previousDayAtMidnight = new Date(previousDay.getFullYear(), previousDay.getMonth(), previousDay.getDate());
    const minDateAtMidnight = new Date(this.minDate().getFullYear(), this.minDate().getMonth(), this.minDate().getDate());
    
    // Disabled als vorige dag kleiner is dan minimum
    return previousDayAtMidnight.getTime() < minDateAtMidnight.getTime();
  });

  isNextDayDisabled = computed(() => {
    const selected = this.selectedDateSignal();
    if (!selected) return false;
    
    const nextDay = new Date(selected);
    nextDay.setDate(nextDay.getDate() + 1);
    
    const nextDayAtMidnight = new Date(nextDay.getFullYear(), nextDay.getMonth(), nextDay.getDate());
    const maxDateAtMidnight = new Date(this.maxDate.getFullYear(), this.maxDate.getMonth(), this.maxDate.getDate());
    
    // Disabled als volgende dag groter is dan vandaag
    return nextDayAtMidnight.getTime() > maxDateAtMidnight.getTime();
  });

  constructor(private zoomPanService: ZoomPanService) {
    // Sync FormControl value changes met het signal
    this.selectedDate.valueChanges.subscribe(value => {
      this.selectedDateSignal.set(value);
    });
  }

  previousDay(): void {
    if (this.isPreviousDayDisabled()) return;
    
    const currentDate = this.selectedDate.value || new Date();
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() - 1);
    this.selectedDate.setValue(newDate);
  }

  nextDay(): void {
    if (this.isNextDayDisabled()) return;
    
    const currentDate = this.selectedDate.value || new Date();
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() + 1);
    this.selectedDate.setValue(newDate);
  }

  /**
   * Reset zoom and pan to default state
   */
  resetZoomPan(): void {
    this.zoomPanService.reset();
  }

  /**
   * Get current zoom/pan state
   */
  getZoomPanState() {
    return this.zoomPanService.state();
  }
}
