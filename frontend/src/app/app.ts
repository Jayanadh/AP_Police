import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmHost } from './ui/confirm-dialog';
import { ToastHost } from './ui/toast';

@Component({
  imports: [ConfirmHost, RouterOutlet, ToastHost],
  selector: 'app-root',
  template: `<router-outlet /><app-confirm-host /><app-toast-host />`,
})
export class App {}
