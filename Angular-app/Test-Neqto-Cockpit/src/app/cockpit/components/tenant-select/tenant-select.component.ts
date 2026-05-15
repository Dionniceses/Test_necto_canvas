import { Component, output, signal } from '@angular/core';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { MapItem } from '@capturum/ui/api';
import { CapturumDropdownModule } from '@capturum/ui/dropdown';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-tenant-select',
  imports: [ReactiveFormsModule, CapturumDropdownModule, TranslateModule],
  templateUrl: './tenant-select.component.html',
  styleUrl: './tenant-select.component.scss',
})
export class TenantSelectComponent {
  readonly tenantChange = output<string | null>();

  readonly tenantControl = new FormControl<string | null>(null);
  // No tenants available yet — placeholder for future wiring.
  readonly tenants = signal<MapItem[]>([]);

  onTenantChange(value: string | null): void {
    this.tenantChange.emit(value);
  }
}
