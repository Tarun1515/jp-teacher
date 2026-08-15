import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  ConfirmDialogService,
  HasUnsavedChanges,
  MasterService,
  ToastService,
} from 'jp-shared/core';
import { DocumentType, Lookup, MASTER_KEYS } from 'jp-shared/models';
import { Observable } from 'rxjs';
import {
  UiBadgeComponent,
  UiButtonComponent,
  UiModalComponent,
  UiMultiSelectComponent,
  UiSelectOption,
} from 'jp-shared/ui';

import { NO_RESUME_CAP, ProfileSection, isHeldByResumeCap } from '../../../core/profile-completion';
import { ProfileMeterComponent } from '../profile-meter/profile-meter.component';
import {
  SaveExperienceBody,
  TeacherDocument,
  TeacherExperience,
  TeacherProfile,
  TeacherService,
  UpdateTeacherProfileBody,
} from '../../../core/teacher.service';

type SaveState = 'idle' | 'saving' | 'saved' | 'conflict';

/** 1 basic · 2 conversational · 3 fluent · 4 native (2.51). */
const PROFICIENCY = [
  { value: 1, label: 'Basic' },
  { value: 2, label: 'Conversational' },
  { value: 3, label: 'Fluent' },
  { value: 4, label: 'Native' },
];

/**
 * The teacher's profile — the largest screen in the product, and the one that
 * decides whether anybody finishes signing up.
 *
 * ----------------------------------------------------------------------------
 * 🔴 EVERYTHING HERE IS DESIGNED AGAINST ABANDONMENT
 * ----------------------------------------------------------------------------
 * Long forms lose people at every step that feels like work. That is the thing
 * being designed against, more than any visual:
 *
 *   NINE SECTIONS, NINE SAVES. Nothing is lost by stopping halfway, and nobody
 *   has to scroll past their photo gallery to fix a phone number.
 *
 *   ONE SUGGESTION AT A TIME. The completion meter names the single
 *   highest-value missing thing with a reason — never a checklist of eight, and
 *   never a bare "0%", which tells somebody they have achieved nothing before
 *   they have started.
 *
 *   MONTHS, NOT DATES, for experience. Nobody remembers the day they started at
 *   a school; everybody remembers the month. Asking for precision people do not
 *   have is how a form starts feeling like an exam.
 *
 * ----------------------------------------------------------------------------
 * SECTION-LEVEL SAVE, SAME REASONING AS 3F
 * ----------------------------------------------------------------------------
 * The server's unit of update is the whole row with one RowVersion, so the three
 * sections backed by the profile row (basics, qualifications, salary) each send
 * the complete body. A 409 shows a reload and is NEVER retried with a fresh
 * RowVersion — that retry is the silent overwrite, wearing a helpful face.
 *
 * The bridge sections (subjects, class levels, skills, languages, locations)
 * have their own endpoints and each sends its COMPLETE set (2.53, 2.54).
 *
 * ----------------------------------------------------------------------------
 * ⚠️ TotalExperienceMonths IS NEVER COMPUTED HERE
 * ----------------------------------------------------------------------------
 * The server recomputes it on every experience change (2.54). 3B found
 * hand-written totals disagreeing with their own evidence by up to thirteen
 * months; 3D found DATEDIFF(MONTH) undercounting every closed job by one. This
 * screen re-reads the profile after each change and displays what came back.
 */
@Component({
  selector: 'app-teacher-profile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    UiBadgeComponent,
    UiButtonComponent,
    UiModalComponent,
    UiMultiSelectComponent,
    ProfileMeterComponent,
  ],
  templateUrl: './teacher-profile.component.html',
  styleUrl: './teacher-profile.component.scss',
})
export class TeacherProfileComponent implements HasUnsavedChanges, OnDestroy {
  private readonly teachers = inject(TeacherService);
  private readonly masters = inject(MasterService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly fb = inject(FormBuilder);

  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  protected readonly profile = signal<TeacherProfile | null>(null);
  protected readonly draft = signal<UpdateTeacherProfileBody | null>(null);

  protected readonly saveState = signal<Record<ProfileSection, SaveState>>({
    basics: 'idle',
    photo: 'idle',
    qualifications: 'idle',
    subjects: 'idle',
    skills: 'idle',
    experience: 'idle',
    locations: 'idle',
    salary: 'idle',
    documents: 'idle',
  });

  protected readonly dirty = signal<ReadonlySet<ProfileSection>>(new Set());

  // ---- masters ------------------------------------------------------------
  protected readonly genders = signal<Lookup[]>([]);
  protected readonly qualifications = signal<Lookup[]>([]);
  protected readonly designations = signal<Lookup[]>([]);
  protected readonly subjects = signal<Lookup[]>([]);
  protected readonly classLevels = signal<Lookup[]>([]);
  protected readonly skills = signal<Lookup[]>([]);
  protected readonly languages = signal<Lookup[]>([]);
  protected readonly states = signal<Lookup[]>([]);
  protected readonly documentTypes = signal<DocumentType[]>([]);

  protected readonly proficiencies = PROFICIENCY;

  protected readonly subjectOptions = computed(() => toOptions(this.subjects()));
  protected readonly classLevelOptions = computed(() => toOptions(this.classLevels()));
  protected readonly skillOptions = computed(() => toOptions(this.skills()));
  protected readonly languageOptions = computed(() => toOptions(this.languages()));
  protected readonly stateOptions = computed(() => toOptions(this.states()));

  protected readonly designationOptions = computed(() => this.designations());
  protected readonly qualificationOptions = computed(() => this.qualifications());

  // ---- the bridge selections ----------------------------------------------
  protected readonly selectedSubjects = signal<number[]>([]);
  protected readonly selectedClassLevels = signal<number[]>([]);
  protected readonly selectedSkills = signal<number[]>([]);
  protected readonly selectedLanguages = signal<number[]>([]);
  protected readonly proficiencyByLanguage = signal<Record<number, number | null>>({});
  protected readonly selectedStates = signal<number[]>([]);

  // ---- files --------------------------------------------------------------
  protected readonly photoUrl = signal<string | null>(null);
  protected readonly uploadingPhoto = signal(false);
  protected readonly uploadingResume = signal(false);
  protected readonly uploadingDocument = signal<number | null>(null);

  // ---- experience ---------------------------------------------------------
  protected readonly editingExperience = signal<TeacherExperience | 'new' | null>(null);
  protected readonly savingExperience = signal(false);

  protected readonly experienceForm = this.fb.nonNullable.group({
    schoolName: ['', [Validators.required, Validators.maxLength(200)]],
    designationId: [null as number | null],
    subjectId: [null as number | null],
    /** ⚠️ `yyyy-MM` from <input type="month">; the day is added on save. */
    fromMonth: ['', [Validators.required]],
    toMonth: [''],
    isCurrent: [false],
  });

  constructor() {
    for (const [key, target] of [
      [MASTER_KEYS.gender, this.genders],
      [MASTER_KEYS.qualification, this.qualifications],
      [MASTER_KEYS.designation, this.designations],
      [MASTER_KEYS.subject, this.subjects],
      [MASTER_KEYS.classLevel, this.classLevels],
      [MASTER_KEYS.skill, this.skills],
      [MASTER_KEYS.language, this.languages],
      [MASTER_KEYS.state, this.states],
    ] as const) {
      this.masters.get(key).subscribe({
        next: (items) => target.set(items),
        error: () => target.set([]),
      });
    }

    this.teachers.documentTypes().subscribe({
      next: (items) => this.documentTypes.set(items),
      // A missing list is a smaller problem than a broken screen: the section
      // shows nothing to upload rather than failing the whole page.
      error: () => this.documentTypes.set([]),
    });

    this.load();
  }

  ngOnDestroy(): void {
    const url = this.photoUrl();
    if (url) URL.revokeObjectURL(url);
  }

  // =========================================================================
  // LOADING
  // =========================================================================

  protected load(): void {
    this.loading.set(true);
    this.loadFailed.set(false);

    this.teachers.getProfile().subscribe({
      next: (profile) => {
        this.apply(profile);
        this.loading.set(false);
      },
      error: () => {
        this.loadFailed.set(true);
        this.loading.set(false);
      },
    });
  }

  private apply(profile: TeacherProfile): void {
    this.profile.set(profile);

    this.draft.set({
      rowVersion: profile.rowVersion,
      fullName: profile.fullName,
      dob: profile.dob,
      genderId: profile.genderId,
      qualificationId: profile.qualificationId,
      highestQualificationText: profile.highestQualificationText,
      designationId: profile.designationId,
      currentSchool: profile.currentSchool,
      lastSchool: profile.lastSchool,
      expectedSalaryMin: profile.expectedSalaryMin,
      expectedSalaryMax: profile.expectedSalaryMax,
      currentCityId: profile.currentCityId,
      currentStateId: profile.currentStateId,
      aboutMe: profile.aboutMe,
    });

    this.selectedSubjects.set([...profile.subjectIds]);
    this.selectedClassLevels.set([...profile.classLevelIds]);
    this.selectedSkills.set([...profile.skillIds]);

    this.selectedLanguages.set(profile.languages.map((l) => l.languageId));
    this.proficiencyByLanguage.set(
      Object.fromEntries(profile.languages.map((l) => [l.languageId, l.proficiencyLevel])),
    );

    /*
      ⚠️ Preferred locations are states today, because the city dataset has not
      been imported (2.47) and a location with a null city means "anywhere in
      this state" — a real preference, not a placeholder.
    */
    this.selectedStates.set(profile.preferredLocations.map((l) => l.stateId));

    this.dirty.set(new Set());
    this.loadPhoto(profile);
  }

  private loadPhoto(profile: TeacherProfile): void {
    const previous = this.photoUrl();
    if (previous) URL.revokeObjectURL(previous);

    this.photoUrl.set(null);

    if (!profile.photoPath) return;

    this.teachers.loadFile(this.teachers.photoUrl()).subscribe({
      next: (url) => this.photoUrl.set(url),
      error: () => this.photoUrl.set(null),
    });
  }

  /** Re-reads after any change, so the derived numbers are the server's. */
  private refresh(section?: ProfileSection): void {
    this.teachers.getProfile().subscribe({
      next: (profile) => {
        this.profile.set(profile);

        // Only the RowVersion is taken; the rest of the draft is whatever they
        // have since typed in another section.
        this.draft.update((d) => (d === null ? d : { ...d, rowVersion: profile.rowVersion }));

        if (section === 'photo') this.loadPhoto(profile);
      },
      error: () => undefined,
    });
  }

  // =========================================================================
  // DRAFT AND SAVE
  // =========================================================================

  protected value<K extends keyof UpdateTeacherProfileBody>(
    field: K,
  ): UpdateTeacherProfileBody[K] | null {
    return this.draft()?.[field] ?? null;
  }

  protected set<K extends keyof UpdateTeacherProfileBody>(
    field: K,
    value: UpdateTeacherProfileBody[K],
    section: ProfileSection,
  ): void {
    this.draft.update((draft) => (draft === null ? draft : { ...draft, [field]: value }));
    this.markDirty(section);
  }

  private markDirty(section: ProfileSection): void {
    this.dirty.update((current) => {
      if (current.has(section)) return current;

      const next = new Set(current);
      next.add(section);

      return next;
    });

    this.saveState.update((state) =>
      state[section] === 'saved' ? { ...state, [section]: 'idle' } : state,
    );
  }

  private clearDirty(section: ProfileSection): void {
    this.dirty.update((current) => {
      const next = new Set(current);
      next.delete(section);

      return next;
    });
  }

  protected isDirty(section: ProfileSection): boolean {
    return this.dirty().has(section);
  }

  protected stateOf(section: ProfileSection): SaveState {
    return this.saveState()[section];
  }

  private setState(section: ProfileSection, state: SaveState): void {
    this.saveState.update((current) => ({ ...current, [section]: state }));
  }

  /** Saves the profile row on behalf of one of its sections. */
  protected saveSection(section: ProfileSection): void {
    const draft = this.draft();
    if (draft === null) return;

    this.setState(section, 'saving');

    this.teachers.updateProfile(draft).subscribe({
      next: () => {
        this.setState(section, 'saved');
        this.clearDirty(section);
        this.refresh();
      },
      error: (error: unknown) => {
        if (codeOf(error) === 'CONCURRENCY_CONFLICT') {
          this.setState(section, 'conflict');
          return;
        }

        this.setState(section, 'idle');
      },
    });
  }

  protected reloadAfterConflict(): void {
    this.load();
    this.toast.info('Reloaded. What is on screen is the saved version now.');
  }

  // =========================================================================
  // THE FIVE FULL-SET SECTIONS
  // =========================================================================

  protected onSubjectsChange(ids: (string | number)[]): void {
    this.selectedSubjects.set(ids.map(Number));
    this.markDirty('subjects');
  }

  protected onClassLevelsChange(ids: (string | number)[]): void {
    this.selectedClassLevels.set(ids.map(Number));
    this.markDirty('subjects');
  }

  protected onSkillsChange(ids: (string | number)[]): void {
    this.selectedSkills.set(ids.map(Number));
    this.markDirty('skills');
  }

  protected onLanguagesChange(ids: (string | number)[]): void {
    const next = ids.map(Number);
    this.selectedLanguages.set(next);

    // Keep the levels of the ones that survived; a language removed and added
    // back starts unrated rather than silently keeping an old answer.
    this.proficiencyByLanguage.update((current) =>
      Object.fromEntries(next.map((id) => [id, current[id] ?? null])),
    );

    this.markDirty('skills');
  }

  protected onStatesChange(ids: (string | number)[]): void {
    this.selectedStates.set(ids.map(Number));
    this.markDirty('locations');
  }

  protected proficiencyOf(languageId: number): number | null {
    return this.proficiencyByLanguage()[languageId] ?? null;
  }

  protected setProficiency(languageId: number, level: number | null): void {
    this.proficiencyByLanguage.update((current) => ({ ...current, [languageId]: level }));
    this.markDirty('skills');
  }

  protected languageName(languageId: number): string {
    return this.languages().find((l) => l.id === languageId)?.name ?? '';
  }

  /**
   * Saves subjects and class levels — two endpoints, one button.
   *
   * ⚠️ Both send their COMPLETE set. Sending only the newly ticked subject would
   * remove every other one (2.54).
   */
  protected saveSubjects(): void {
    this.setState('subjects', 'saving');

    this.teachers.saveSubjects(this.selectedSubjects()).subscribe({
      next: () => {
        this.teachers.saveClassLevels(this.selectedClassLevels()).subscribe({
          next: () => {
            this.setState('subjects', 'saved');
            this.clearDirty('subjects');
            this.refresh();
          },
          error: () => this.setState('subjects', 'idle'),
        });
      },
      error: () => this.setState('subjects', 'idle'),
    });
  }

  protected saveSkillsAndLanguages(): void {
    this.setState('skills', 'saving');

    const languages = this.selectedLanguages().map((languageId) => ({
      languageId,
      proficiencyLevel: this.proficiencyOf(languageId),
    }));

    this.teachers.saveSkills(this.selectedSkills()).subscribe({
      next: () => {
        this.teachers.saveLanguages(languages).subscribe({
          next: () => {
            this.setState('skills', 'saved');
            this.clearDirty('skills');
            this.refresh();
          },
          error: () => this.setState('skills', 'idle'),
        });
      },
      error: () => this.setState('skills', 'idle'),
    });
  }

  protected saveLocations(): void {
    this.setState('locations', 'saving');

    /*
      ⚠️ cityId is null and stateId carries the answer: "anywhere in this state"
      is the only preference expressible until the city dataset arrives (2.47),
      and it is a real one rather than a stand-in.

      preferenceOrder is the order they appear in — first chosen, first
      preference — which is what somebody means by listing them.
    */
    const locations = this.selectedStates().map((stateId, index) => ({
      cityId: null,
      stateId,
      preferenceOrder: index + 1,
    }));

    this.teachers.savePreferredLocations(locations).subscribe({
      next: () => {
        this.setState('locations', 'saved');
        this.clearDirty('locations');
        this.refresh();
      },
      error: () => this.setState('locations', 'idle'),
    });
  }

  // =========================================================================
  // EXPERIENCE — entities, not a set
  // =========================================================================

  protected readonly sortedExperiences = computed(() =>
    [...(this.profile()?.experiences ?? [])].sort((a, b) => {
      // Current roles first, then most recent start. That is the order somebody
      // reads a CV in, and the order a principal scans for.
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;

      return b.fromDate.localeCompare(a.fromDate);
    }),
  );

  /** "4 years 2 months", from the SERVER's number. Never computed here. */
  protected readonly experienceSummary = computed(() => {
    const months = this.profile()?.totalExperienceMonths ?? 0;

    if (months <= 0) return null;

    const years = Math.floor(months / 12);
    const rest = months % 12;

    if (years === 0) return `${rest} month${rest === 1 ? '' : 's'} of teaching experience`;
    if (rest === 0) return `${years} year${years === 1 ? '' : 's'} of teaching experience`;

    return `${years} year${years === 1 ? '' : 's'} ${rest} month${rest === 1 ? '' : 's'} of teaching experience`;
  });

  protected openAddExperience(): void {
    this.experienceForm.reset({
      schoolName: '',
      designationId: null,
      subjectId: null,
      fromMonth: '',
      toMonth: '',
      isCurrent: false,
    });

    this.editingExperience.set('new');
  }

  protected openEditExperience(experience: TeacherExperience): void {
    this.experienceForm.reset({
      schoolName: experience.schoolName,
      designationId: experience.designationId,
      subjectId: experience.subjectId,
      fromMonth: toMonthInput(experience.fromDate),
      toMonth: toMonthInput(experience.toDate),
      isCurrent: experience.isCurrent,
    });

    this.editingExperience.set(experience);
  }

  protected onIsCurrentChange(isCurrent: boolean): void {
    this.experienceForm.patchValue({ isCurrent });

    // "I work here now" and an end date are contradictory, and the procedure
    // refuses the pair. Clearing it here means nobody meets that refusal.
    if (isCurrent) {
      this.experienceForm.patchValue({ toMonth: '' });
    }
  }

  protected saveExperience(): void {
    const target = this.editingExperience();
    if (target === null) return;

    const value = this.experienceForm.getRawValue();

    if (this.experienceForm.invalid) {
      this.experienceForm.markAllAsTouched();
      return;
    }

    if (!value.isCurrent && !value.toMonth) {
      this.toast.error('When did you leave? Tick “I work here now” if you have not.');
      return;
    }

    const body: SaveExperienceBody = {
      schoolName: value.schoolName.trim(),
      designationId: value.designationId,
      subjectId: value.subjectId,
      fromDate: `${value.fromMonth}-01`,
      // ⚠️ The LAST day of the month it ended, not the first: a job that ran to
      // March ran through March. 3D found DATEDIFF undercounting exactly this.
      toDate: value.isCurrent || !value.toMonth ? null : lastDayOfMonth(value.toMonth),
      isCurrent: value.isCurrent,
    };

    this.savingExperience.set(true);

    // Typed as unknown because add returns the new id and update returns
    // nothing — neither result is used here, since the profile is re-read.
    const request: Observable<unknown> =
      target === 'new'
        ? this.teachers.addExperience(body)
        : this.teachers.updateExperience(target.id, body);

    request.subscribe({
      next: () => {
        this.savingExperience.set(false);
        this.editingExperience.set(null);
        this.toast.success(target === 'new' ? 'Added.' : 'Updated.');

        // 🔴 Re-read: TotalExperienceMonths was just recomputed by the server,
        // and so was the completion percentage.
        this.refresh();
      },
      error: () => this.savingExperience.set(false),
    });
  }

  protected async removeExperience(experience: TeacherExperience): Promise<void> {
    const ok = await this.confirm.ask({
      title: `Remove ${experience.schoolName}?`,
      message: 'It will no longer appear on your profile, and your total experience will go down.',
      confirmText: 'Remove',
      danger: true,
    });

    if (!ok) return;

    this.teachers.deleteExperience(experience.id).subscribe({
      next: () => {
        this.toast.success('Removed.');
        this.refresh();
      },
      error: () => undefined,
    });
  }

  protected experienceDates(experience: TeacherExperience): string {
    const from = monthLabel(experience.fromDate);

    return experience.isCurrent ? `${from} — now` : `${from} — ${monthLabel(experience.toDate)}`;
  }

  protected designationName(id: number | null): string | null {
    return id === null ? null : (this.designations().find((d) => d.id === id)?.name ?? null);
  }

  protected subjectName(id: number | null): string | null {
    return id === null ? null : (this.subjects().find((s) => s.id === id)?.name ?? null);
  }

  // =========================================================================
  // FILES
  // =========================================================================

  protected onPhotoChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';

    if (!file) return;

    this.uploadingPhoto.set(true);

    this.teachers.uploadPhoto(file).subscribe({
      next: () => {
        this.uploadingPhoto.set(false);
        this.toast.success('Photo saved.');
        this.refresh('photo');
      },
      error: () => this.uploadingPhoto.set(false),
    });
  }

  /**
   * The resume.
   *
   * 🔴 THE HIGHEST-STAKES ACTION ON THIS SCREEN, so both outcomes are
   * unmistakable: success says what changed about their profile, and failure
   * says the old one is still there — because the fear after a failed upload is
   * that the file you had is gone too.
   */
  protected onResumeChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';

    if (!file) return;

    const hadResume = !!this.profile()?.resumePath;

    // ⚠️ Read through the same function the meter uses, not a second copy of
    // the rule — this decides which sentence the teacher gets after the upload,
    // and it has to agree with the bar they were just looking at (2.60).
    const wasCapped = isHeldByResumeCap(this.profile());

    this.uploadingResume.set(true);

    this.teachers.uploadResume(file).subscribe({
      next: () => {
        this.uploadingResume.set(false);

        this.toast.success(
          wasCapped
            ? 'Resume uploaded — that was the last thing holding your profile at 75%.'
            : hadResume
              ? 'Resume replaced. Schools will see the new one.'
              : 'Resume uploaded. It is the biggest single thing on your profile.',
          7000,
        );

        this.refresh();
      },
      error: () => {
        this.uploadingResume.set(false);

        this.toast.error(
          hadResume
            ? 'That upload failed — your existing resume is untouched, so nothing has been lost.'
            : 'That upload failed. Nothing was saved; try again, or try a smaller PDF.',
          9000,
        );
      },
    });
  }

  protected onDocumentChosen(event: Event, documentTypeId: number): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';

    if (!file) return;

    this.uploadingDocument.set(documentTypeId);

    this.teachers.uploadDocument(documentTypeId, file).subscribe({
      next: () => {
        this.uploadingDocument.set(null);
        this.toast.success('Document uploaded.');
        this.refresh();
      },
      error: () => {
        this.uploadingDocument.set(null);

        // ⚠️ One failure must not disturb the others. Nothing is cleared here —
        // the list is re-read from the server, which still holds every document
        // that did upload.
        this.toast.error('That document did not upload. The others are unaffected.');
      },
    });
  }

  protected async removeDocument(document: TeacherDocument): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Remove this document?',
      message: `${document.fileName} will be removed from your profile.`,
      confirmText: 'Remove',
      danger: true,
    });

    if (!ok) return;

    this.teachers.deleteDocument(document.documentId).subscribe({
      next: () => {
        this.toast.success('Removed.');
        this.refresh();
      },
      error: () => undefined,
    });
  }

  protected openFile(url: string): void {
    // Fetched with the bearer token, then handed to the browser as a blob —
    // window.open on the endpoint itself would arrive unauthenticated.
    this.teachers.loadFile(url).subscribe({
      next: (objectUrl) => {
        window.open(objectUrl, '_blank', 'noopener');

        // Freed once the new tab has had a chance to take it.
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      },
      error: () => this.toast.error('That file could not be opened.'),
    });
  }

  /**
   * The cap the resume lifts, for the copy in that section.
   *
   * ⚠️ Read from the same constant the meter uses. Two numbers meaning the same
   * thing is how a screen ends up saying 75 in one place and 80 in another.
   */
  protected readonly resumeCap = NO_RESUME_CAP;

  protected readonly resumeHref = this.teachers.resumeUrl();

  protected documentHref(documentId: number): string {
    return this.teachers.documentUrl(documentId);
  }

  protected documentTypeName(id: number): string {
    return this.documentTypes().find((d) => d.id === id)?.name ?? 'Document';
  }

  protected documentsFor(): DocumentType[] {
    // Request type 2 is teacher verification (2.47).
    return this.documentTypes().filter((d) => d.requestTypeId === 2);
  }

  protected hasDocument(documentTypeId: number): TeacherDocument | null {
    return this.profile()?.documents.find((d) => d.documentTypeId === documentTypeId) ?? null;
  }

  // =========================================================================
  // LEAVING
  // =========================================================================

  hasUnsavedChanges(): boolean {
    return this.dirty().size > 0;
  }

  unsavedChangesMessage(): string {
    const names = [...this.dirty()].map((s) => SECTION_LABELS[s]).join(', ');

    return `You have unsaved changes in ${names}. Leave this page and lose them?`;
  }

  protected scrollTo(section: ProfileSection): void {
    document.getElementById(`section-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected readonly skeletonRows = [0, 1, 2, 3];
}

const SECTION_LABELS: Record<ProfileSection, string> = {
  basics: 'About you',
  photo: 'Photo',
  qualifications: 'Qualifications',
  subjects: 'Subjects and classes',
  skills: 'Skills and languages',
  experience: 'Experience',
  locations: 'Where you want to work',
  salary: 'Expected salary',
  documents: 'Resume and documents',
};

function toOptions(items: Lookup[]): UiSelectOption[] {
  return items.map((item) => ({ value: item.id, label: item.name }));
}

/** `2019-03-01` -> `2019-03`, for <input type="month">. */
function toMonthInput(date: string | null): string {
  return date ? date.slice(0, 7) : '';
}

/** `2019-03` -> `2019-03-31`. */
function lastDayOfMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const day = new Date(year, monthNumber, 0).getDate();

  return `${month}-${String(day).padStart(2, '0')}`;
}

/** `2019-03-01` -> `March 2019`. */
function monthLabel(date: string | null): string {
  if (!date) return '—';

  const parsed = new Date(`${date.slice(0, 10)}T00:00:00`);

  return parsed.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

/** The response code, never the message text (2.12). */
function codeOf(error: unknown): string | null {
  return (error as { error?: { code?: string } } | null)?.error?.code ?? null;
}
