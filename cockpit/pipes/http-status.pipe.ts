import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'httpStatus',
})
export class HttpStatusPipe implements PipeTransform {
  transform(responseCode: number | null, statusType: 'success' | 'error' | 'amber'): boolean {
    if (responseCode === null) {
      return false;
    }

    switch (statusType) {
      case 'success':
        return responseCode >= 200 && responseCode < 300;
      case 'error':
        return responseCode >= 400;
      case 'amber':
        return responseCode >= 300 && responseCode < 400;
      default:
        return false;
    }
  }
}
