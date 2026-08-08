import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmDialogComponent, LoaderComponent, ToastContainerComponent } from 'jp-shared/ui';
import { AppAccessService } from 'jp-shared/core';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, LoaderComponent, ToastContainerComponent, ConfirmDialogComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  private readonly access = inject(AppAccessService);

  constructor() {
    /*
      A token may already be in storage from an earlier session — or, on a
      shared origin, from a sibling app. Check it belongs here before any route
      renders, so a school owner reloading the teacher app is signed out and
      redirected rather than dropped into an empty shell.
    */
    this.access.enforce();
  }
}
