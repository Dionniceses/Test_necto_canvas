import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { PauseLiveComponent } from './pause-live.component';

describe('PauseLiveComponent', () => {
  let component: PauseLiveComponent;
  let fixture: ComponentFixture<PauseLiveComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PauseLiveComponent, TranslateModule.forRoot()],
    }).compileComponents();

    fixture = TestBed.createComponent(PauseLiveComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit pause toggle when pause button is clicked', () => {
    const pauseSpy = spyOn(component.pauseToggled, 'emit');
    const pauseButton = fixture.nativeElement.querySelector('cap-button.control-button button') as HTMLButtonElement;

    pauseButton.click();

    expect(pauseSpy).toHaveBeenCalledTimes(1);
  });

  it('should emit go live when go-live button is clicked while delayed', () => {
    fixture.componentRef.setInput('isLive', false);
    fixture.detectChanges();

    const goLiveSpy = spyOn(component.goLive, 'emit');
    const goLiveButton = fixture.nativeElement.querySelector(
      'cap-button.control-button--live button',
    ) as HTMLButtonElement;

    goLiveButton.click();

    expect(goLiveSpy).toHaveBeenCalledTimes(1);
  });

  it('should disable go-live button while already live', () => {
    fixture.componentRef.setInput('isLive', true);
    fixture.detectChanges();

    const goLiveButton = fixture.nativeElement.querySelector(
      'cap-button.control-button--live button',
    ) as HTMLButtonElement;

    expect(goLiveButton.disabled).toBeTrue();
  });

  it('should show live fps value', () => {
    fixture.componentRef.setInput('fps', 58);
    fixture.detectChanges();

    const fpsCounter = fixture.nativeElement.querySelector('.fps-counter') as HTMLElement;

    expect(fpsCounter.textContent?.trim()).toBe('58 FPS');
  });
});
