import { ChangeDetectionStrategy, Component, inject, isDevMode } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import {
  AppAccessService,
  ConfirmDialogComponent,
  LoaderComponent,
  ToastContainerComponent,
  logSharedVersion,
} from '@tarun1515/jp-shared';

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

    /*
      Which copy of @tarun1515/jp-shared is this app actually running?

      Four projects means four node_modules and four independent copies of the
      library. This line is one third of the drift mitigation — the others are
      the version constant in jp-shared and `npm run check-shared-versions` at
      the repo root. Dev mode only: a developer's tool, not something users see.
    */
    logSharedVersion('jp-teacher', isDevMode());
  }
}
