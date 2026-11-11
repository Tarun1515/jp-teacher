import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  Signal,
  WritableSignal,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  ConfirmDialogService,
  HasUnsavedChanges,
  MasterService,
  ToastService,
  ResolvedAddress,
} from 'jp-shared/core';
import { DocumentType, Lookup, MASTER_KEYS } from 'jp-shared/models';
import { Observable } from 'rxjs';
import {
  UiBadgeComponent,
  UiButtonComponent,
  UiComboboxComponent,
  UiModalComponent,
  UiMultiSelectComponent,
  UiSelectOption,
  lookupsToOptions,
  UiAddressSearchComponent,
} from 'jp-shared/ui';

import { NO_RESUME_CAP, ProfileSection, isHeldByResumeCap } from '../../../core/profile-completion';
import { ProfileMeterComponent } from '../profile-meter/profile-meter.component';
import {
  SaveExperienceBody,
  TeacherDocument,
  TeacherExperience,
  TeacherLocation,
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
 * One row of "where you want to work" — one place, with its own cascade.
 *
 * ----------------------------------------------------------------------------
 * 🔴 EVERY ROW OWNS ITS OWN LISTS, AND IT HAS TO
 * ----------------------------------------------------------------------------
 * Two rows are two different districts, so there is no single `cities()` the
 * screen could hold: row 1 showing Hisar's towns and row 2 showing Sonipat's
 * is the whole point of a per-row picker. A shared list would make the second
 * row overwrite the first one's options the moment anybody touched it.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ THE OPTION ARRAYS ARE `computed` PER ROW, NOT MAPPED IN THE TEMPLATE
 * ----------------------------------------------------------------------------
 * The standing rule (SR-3 / G27) is that a list handed to `<ui-combobox>` must
 * be a `computed` — `lookupsToOptions(row.cities())` written in an `[options]`
 * binding builds a new array on every change-detection pass and hands the
 * OnPush child a new identity each time, which defeats the very check that
 * makes these controls cheap.
 *
 * Per row rather than one `computed` over the whole array deliberately: a
 * single `computed(() => rows().map(...))` would hand EVERY row a new options
 * identity whenever ANY row changed, which is the same defeat one level up.
 * A row's `cityOptions` changes only when that row's own `cities` changes.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ `key` IS FOR `@for` TRACKING ONLY AND IS NEVER SENT
 * ----------------------------------------------------------------------------
 * Tracking by index would re-use one row's DOM — and therefore one row's open
 * combobox and scroll position — for another row after a removal. Tracking by
 * stateId cannot work: two rows legitimately share a state while the second
 * one is still being filled in, and `@for` refuses duplicate keys.
 */
interface PreferredPlace {
  readonly key: number;

  readonly stateId: WritableSignal<number | null>;

  /**
   * ⚠️ NAVIGATIONAL, NOT AN ANSWER. The district is how the town list is
   * reached; `TeacherLocation` has no districtId and none is sent. It is
   * reconstructed from the saved city on re-open — see `districtOfCity`.
   */
  readonly districtId: WritableSignal<number | null>;

  readonly cityId: WritableSignal<number | null>;

  /**
   * 🔴 COLLECTED BUT NOT YET SENT — see `loadTehsilsForCity` and
   * `preferredLocationsToSave`. Today the control never appears, because the
   * list it needs always comes back empty.
   */
  readonly tehsilId: WritableSignal<number | null>;

  readonly districts: WritableSignal<Lookup[]>;
  readonly cities: WritableSignal<Lookup[]>;
  readonly tehsils: WritableSignal<Lookup[]>;

  readonly districtOptions: Signal<UiSelectOption[]>;
  readonly cityOptions: Signal<UiSelectOption[]>;
  readonly tehsilOptions: Signal<UiSelectOption[]>;
}

/** Monotonic, module-scoped, so a removed row's key is never re-issued. */
let nextPlaceKey = 0;

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
    UiAddressSearchComponent,
    UiBadgeComponent,
    UiButtonComponent,
    UiComboboxComponent,
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

  /*
    ---------------------------------------------------------------------------
    P1. THE ADDRESS ORDER, AND WHY IT IS NOT THE ADMINISTRATIVE ONE
    ---------------------------------------------------------------------------
    Every address in the product now asks

        State -> District -> City/Town -> Tehsil/Sub-tehsil -> Village/Area

    and each control is DRIVEN BY the one above it. That is not how revenue
    administration is organised — a tehsil sits above its towns — but it is how
    people think. Nobody says "I am in Gohana tehsil"; they say "I am in
    Gohana". Asking for the tehsil first also put the SAME NAME in front of the
    user twice, once as a tehsil and once as its headquarters town, and the
    client watched people pick the wrong one.

    🔴 CITY IS LOADED BY DISTRICT, NEVER NARROWED BY TEHSIL. The old order used
    the tehsil to narrow the town list, which made an "optional" step really
    mean "required and badly labelled". Towns come from the district, all of
    them, and the tehsil is pure extra detail afterwards.

    ---------------------------------------------------------------------------
    "WHERE YOU LIVE" STOPS AT THE TOWN, AND THE REASON IS THE TABLE
    ---------------------------------------------------------------------------
    🔴 `t_app_teachers` HAS ONLY CurrentCityId AND CurrentStateId. jp_app's
    036_alter_address_columns.sql added TehsilId/AreaOrVillage to schools, to
    branches and to teacher preferred locations, and deliberately not to the
    teacher row — so `UpdateTeacherProfileBody` has nowhere to put a tehsil or
    a village, and `set()` would not even compile with one.

    So this cascade renders State -> District -> City/Town and stops. A control
    whose value cannot leave the component is a control that eats what somebody
    typed, and this file's own DTO comment says it best: "a field the server
    ignores is a field somebody will one day expect it to honour."

    ⚠️ DISTRICT IS NAVIGATIONAL HERE TOO. It is not in the draft and is not
    sent; it exists so the town list can be reached, and is reconstructed from
    the saved city on re-open.
  */
  protected readonly homeDistricts = signal<Lookup[]>([]);
  protected readonly homeCities = signal<Lookup[]>([]);
  protected readonly homeDistrictId = signal<number | null>(null);

  /*
    ---------------------------------------------------------------------------
    THE ADDRESS SEARCH BOX IS `<ui-address-search>`, AND IT HOLDS NO STATE HERE
    ---------------------------------------------------------------------------
    🔴 THE THREE DROPDOWNS BELOW DO NOT CHANGE IN ANY WAY. The search box sits
    on top of them and fills them in; it is one more way to answer the same
    question, for somebody who would rather type "Sector 12, Gohana" than walk
    three lists. Everything it can do, the dropdowns can still do, and the day
    the provider is switched off the form is exactly what it was — the control
    asks `availability` itself and renders nothing at all when it is false.

    ⚠️ SO THERE IS NO SEARCH STATE ON THIS COMPONENT, DELIBERATELY. The query,
    the suggestions, the debounce, the 3-character floor, the keyboard walk and
    the "we could not find the district …" line all live in jp-shared. The box
    reaches this screen through exactly one door — `(resolved)` ->
    `onHomeAddressResolved` — and a typed query can therefore never touch
    `draft`, which is what keeps the Save button from arming over an edit
    nobody made (the trap `applyHomeLocation` carries a comment about for
    `homeDistrictId`). The only thing that marks this card dirty is a resolved
    address actually CHANGING the state or the town.
  */

  /** One row per place the teacher would work. The order IS the preference. */
  protected readonly places = signal<readonly PreferredPlace[]>([]);

  /*
    SR-3 (G27). Every master this screen puts in a dropdown, as options.

    ⚠️ COMPUTED, NOT MAPPED INLINE IN THE TEMPLATE. `lookupsToOptions(subjects())`
    written in an `[options]` binding runs on every change-detection pass and
    hands the OnPush child a new array identity each time, which defeats the
    very check that makes these controls cheap.

    ⚠️ ONE CONVERSION FUNCTION, the library's. This file used to carry its own
    `toOptions` — identical, and one more place for the two to drift.
  */
  protected readonly subjectOptions = computed(() => lookupsToOptions(this.subjects()));
  protected readonly classLevelOptions = computed(() => lookupsToOptions(this.classLevels()));
  protected readonly skillOptions = computed(() => lookupsToOptions(this.skills()));
  protected readonly languageOptions = computed(() => lookupsToOptions(this.languages()));
  protected readonly stateOptions = computed(() => lookupsToOptions(this.states()));
  protected readonly designationOptions = computed(() => lookupsToOptions(this.designations()));
  protected readonly qualificationOptions = computed(() =>
    lookupsToOptions(this.qualifications()),
  );

  protected readonly homeDistrictOptions = computed(() => lookupsToOptions(this.homeDistricts()));
  protected readonly homeCityOptions = computed(() => lookupsToOptions(this.homeCities()));

  /*
    🔴 HIDDEN, NOT DISABLED-AND-EMPTY — the same contract the registration form
    has carried since 2.47, and the one every geography endpoint is written to
    honour: it answers cleanly with nothing, and the form hides the control.

    An empty dropdown reads as "this screen is broken"; a disabled one is
    something people keep clicking at. Districts and towns exist for every
    state now, tehsils only for Haryana — so these guards are what lets one
    template serve both without anything looking half-built.

    ⚠️ NOTHING ELSE DEPENDS ON THE HIDDEN CONTROL. The helper lines live on the
    controls themselves, the fields sit in a `.form-grid` with no separators
    between them, and grid auto-flow closes the gap — so an absent control
    leaves no empty cell, no dangling rule and no sentence pointing at a box
    that is not there.
  */
  protected readonly hasHomeDistricts = computed(() => this.homeDistricts().length > 0);
  protected readonly hasHomeCities = computed(() => this.homeCities().length > 0);

  // ---- the bridge selections ----------------------------------------------
  protected readonly selectedSubjects = signal<number[]>([]);
  protected readonly selectedClassLevels = signal<number[]>([]);
  protected readonly selectedSkills = signal<number[]>([]);
  protected readonly selectedLanguages = signal<number[]>([]);
  protected readonly proficiencyByLanguage = signal<Record<number, number | null>>({});

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
      🔴 THE GEOGRAPHY IS APPLIED SEPARATELY, AND IN ORDER.

      Every other field above is a value with nowhere to look it up. A state,
      district, town or tehsil id is only meaningful against the list it came
      from, and those lists are fetched per parent — so applying them is a
      sequence of requests, not an assignment. See `applyLocations`.
    */
    this.applyLocations(profile);

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

    this.teachers.savePreferredLocations(this.preferredLocationsToSave()).subscribe({
      next: () => {
        this.setState('locations', 'saved');
        this.clearDirty('locations');
        this.refresh();
      },
      error: () => this.setState('locations', 'idle'),
    });
  }

  // =========================================================================
  // GEOGRAPHY — ONE CASCADE, TWO PLACES IT IS USED
  // =========================================================================
  //
  // 🔴 THE MASTER KEYS LIVE IN EXACTLY THREE METHODS: `loadDistricts`,
  // `loadCitiesForDistrict` and `loadTehsilsForCity`. Both the teacher's own
  // location and every preferred-location row go through them, so the day a
  // key or an endpoint moves there is one line to change per level — not one
  // per control, which is how two cascades on one screen start disagreeing.

  /**
   * Districts of a state.
   *
   * ----------------------------------------------------------------------------
   * 🔴 `onSettled` IS THE WHOLE POINT OF THESE THREE SIGNATURES
   * ----------------------------------------------------------------------------
   * A saved id is applied INSIDE it, never beside the call — that ordering is
   * what stops a combobox rendering blank for a value it has (`applyPlaces`).
   *
   * ⚠️ AND IT RUNS ON FAILURE TOO, WHICH IS NOT SLOPPINESS. Only the LABEL
   * depends on the list; the VALUE does not. Calling it from `next` alone
   * meant a dropped request silently left `cityId` unset, and the next Save
   * would have widened "Sonipat town" to "anywhere in Haryana" — a change to a
   * preference the teacher never touched. A blank field is a cosmetic failure;
   * that one is data loss, and it is the kind nobody reports because nobody
   * sees it happen.
   */
  private loadDistricts(
    stateId: number,
    into: WritableSignal<Lookup[]>,
    onSettled?: () => void,
  ): void {
    this.masters.getByParent(MASTER_KEYS.district, stateId).subscribe({
      next: (items) => {
        into.set(items);
        onSettled?.();
      },
      // An empty list and a failed call look the same to the form on purpose:
      // both mean "no districts to offer", and both degrade to state-only.
      error: () => {
        into.set([]);
        onSettled?.();
      },
    });
  }

  /**
   * Every town in the district.
   *
   * 🔴 BY DISTRICT, NOT BY TEHSIL, AND ALL OF THEM. The tehsil step is
   * optional and now comes AFTER the town, so narrowing towns by tehsil would
   * mean a teacher who skips the tehsil never reaches a town at all. The
   * masters endpoint returns `DistrictId AS ParentId` for this call, which is
   * what `districtOfCity` reads back on re-open.
   */
  private loadCitiesForDistrict(
    districtId: number,
    into: WritableSignal<Lookup[]>,
    onSettled?: () => void,
  ): void {
    this.masters.getByParent(MASTER_KEYS.city, districtId).subscribe({
      next: (items) => {
        into.set(items);
        onSettled?.();
      },
      error: () => {
        into.set([]);
        onSettled?.();
      },
    });
  }

  /**
   * The tehsils of ONE TOWN — the optional last level of the new order.
   *
   * ----------------------------------------------------------------------------
   * ✅ THE KEY IS REPOINTED — ⚠️ BUT THE SAVE STILL IS NOT
   * ----------------------------------------------------------------------------
   * `m_mdm_city.TehsilId` is the authoritative link and it is guarded in the
   * schema: 039_m_mdm_tehsil.sql asserts that a city's tehsil, when set,
   * belongs to that city's district. It is not expressible through the
   * `Lookup` shape (id/code/name/displayOrder/parentId), so P1 gave it its own
   * master key rather than overloading the district-parented `TEHSIL` branch —
   * a district id and a city id are both plain ints, and a branch that had to
   * guess which it was handed would answer a real list for a real id.
   *
   * `MASTER_KEYS.tehsilByCity` ('tehsil-by-city') is that key, and the call
   * below now uses it. A city with no tehsil returns `[]`, which hides the
   * control exactly as a state with no tehsils always has.
   *
   * 🔴 WHAT IS STILL MISSING, AND WHY NO CONTROL IS RENDERED YET:
   *
   *   THE SAVE. `TeacherLocation` has no `tehsilId`, and neither does the
   *      `dbo.PreferredLocationList` table type nor
   *      USP_SaveTeacherPreferredLocations — although
   *      `t_app_teacher_preferred_locations.TehsilId` EXISTS and 036's own
   *      comment says "SR-3 lands the picker; this is the column it writes
   *      to". Until that hop lands, landing (1) alone would make this control
   *      appear and then silently drop what was chosen. See
   *      `preferredLocationsToSave`.
   */
  private loadTehsilsForCity(
    cityId: number,
    into: WritableSignal<Lookup[]>,
    onSettled?: () => void,
  ): void {
    this.masters.getByParent(MASTER_KEYS.tehsilByCity, cityId).subscribe({
      next: (items) => {
        into.set(items);
        onSettled?.();
      },
      error: () => {
        into.set([]);
        onSettled?.();
      },
    });
  }

  /**
   * Which district a saved town belongs to.
   *
   * ----------------------------------------------------------------------------
   * 🔴 WHY THIS IS NEEDED AT ALL
   * ----------------------------------------------------------------------------
   * What is stored is a town. `t_app_teacher_preferred_locations` has
   * CityId/StateId/TehsilId and NO DistrictId — correctly, because a town
   * already determines its district (`m_mdm_city.DistrictId` is NOT NULL). But
   * the new order needs that district before it can show the town, because the
   * town list is fetched per district. So a saved city has to be PLACED before
   * it can be displayed, and the district is derived, never read back.
   *
   * ⚠️ THE ROW'S OWN CITY LIST CANNOT BE THE SOURCE, which is the obvious first
   * idea and is circular: that list is `city?parentId=<districtId>`, so it
   * cannot be fetched until the district is known. The unparented list is what
   * breaks the cycle.
   *
   * ⚠️ READ FROM `parentId`, NOT COMPUTED FROM THE ID. The unparented city
   * master returns `DistrictId AS ParentId` on every row, and `DistrictId` is
   * NOT NULL on `m_mdm_city`. The seed does namespace ids arithmetically
   * (town = StateId * 10000 + n, district = StateId * 100 + n) and it would be
   * briefly tempting to divide — that is a seed artefact, not a contract, and
   * the day one state is loaded from a different source it would send every
   * saved address somewhere else.
   *
   * ⚠️ ONE UNPARENTED REQUEST, LAZILY, AND SHARED. It is made only when a
   * saved town actually has to be placed, and `MasterService` caches it for
   * the session — so the teacher's own location and all N preferred rows cost
   * one call between them, not N. /browse already loads the same list.
   *
   * ⚠️ AND IT IS THE WHOLE COUNTRY'S TOWNS, which is the price of doing this
   * on the client. About 900 rows today; several thousand once every state's
   * towns are seeded. A `GET /masters/city/{id}` returning one row — or a
   * districtId on the location DTO — would make this a lookup instead of a
   * download. Neither is this agent's to add; it is in the report.
   */
  private districtOfCity(cityId: number, then: (districtId: number | null) => void): void {
    this.masters.get(MASTER_KEYS.city).subscribe({
      next: (cities) => then(cities.find((c) => c.id === cityId)?.parentId ?? null),

      // A town we cannot place is left unplaced rather than guessed at: the
      // state still shows, and the row still saves the town it already had.
      error: () => then(null),
    });
  }

  // ---- the teacher's own location ------------------------------------------

  /**
   * CASCADE RULE: a new state invalidates everything under it.
   *
   * ⚠️ The town is cleared because a town in the old state is now wrong — not
   * merely unlisted, wrong. This is the one clearing that must never be
   * "helpful" and keep the old value.
   */
  protected onHomeStateChange(stateId: number | null): void {
    this.set('currentStateId', stateId, 'salary');
    this.set('currentCityId', null, 'salary');
    this.homeDistrictId.set(null);
    this.homeDistricts.set([]);
    this.homeCities.set([]);

    if (stateId !== null) {
      this.loadDistricts(stateId, this.homeDistricts);
    }
  }

  /** CASCADE RULE: a new district clears the town and reloads the town list. */
  protected onHomeDistrictChange(districtId: number | null): void {
    this.homeDistrictId.set(districtId);
    this.set('currentCityId', null, 'salary');
    this.homeCities.set([]);

    if (districtId !== null) {
      this.loadCitiesForDistrict(districtId, this.homeCities);
    }
  }

  /**
   * CASCADE RULE: the town is the last level here.
   *
   * ⚠️ Nothing hangs off it: there is no tehsil or village control in this
   * section, because `t_app_teachers` has no column for either. See the
   * geography comment above the signals.
   */
  protected onHomeCityChange(cityId: number | null): void {
    this.set('currentCityId', cityId, 'salary');
  }

  // =========================================================================
  // THE ADDRESS SEARCH — WHAT THIS SCREEN DOES WITH AN ANSWER FROM IT
  // =========================================================================
  //
  // 🔴 THE CONTROL IS `<ui-address-search>`, AND IT IS NOT THIS FILE'S. jp-shared
  // owns the box: the debounce, the 3-character floor, the keyboard walk, the
  // suggestion list, the silent degrade on a 429 or a timeout, the "we could not
  // find the district …" line, and the `availability` question that decides
  // whether any of it renders at all. What is left in this file is the only part
  // that is this screen's business — where a resolved address GOES, which is a
  // different question on every form that has one.
  //
  // 🔴 EVERY REQUEST STILL GOES TO OUR OWN API. The shared service talks to
  // three routes on JP.App.Api and nothing else; the provider, the key and the
  // billing all live on the server. Nothing in this component, this template or
  // this bundle names a google domain or holds a key, and nothing may.

  /**
   * A resolved address, poured into the cascade that already exists.
   *
   * ----------------------------------------------------------------------------
   * 🔴 THE VALUES FIRST, THEN THE LISTS THAT GIVE THEM LABELS
   * ----------------------------------------------------------------------------
   * Both answers this form keeps — the state and the town — are decided
   * SYNCHRONOUSLY, in one pass, before any request goes out. Everything async
   * after that is only about fetching the lists the comboboxes need in order to
   * render a label.
   *
   * That ordering is not a style choice. Clearing the town and re-writing it at
   * the end of a chain of requests leaves a window of a few hundred
   * milliseconds in which Save would have sent a state with no town —
   * "anywhere in Haryana" instead of "Gohana", for an edit nobody made. One
   * synchronous write has no such window.
   *
   * ⚠️ AND IT COSTS NOTHING ON SCREEN, because of how the template is built:
   * the District and City comboboxes are behind `hasHomeDistricts()` /
   * `hasHomeCities()`, so neither control is even rendered until its own list
   * has arrived. There is no moment where a filled value reads as blank — the
   * exact failure the 🔴 comment on `applyLocations` is about.
   *
   * ----------------------------------------------------------------------------
   * 🔴 A LEVEL THE RESOLVE DID NOT PRODUCE IS NEVER WRITTEN
   * ----------------------------------------------------------------------------
   * A search that found less than the form already holds must not be allowed to
   * erase the difference. `unmatched` names the levels our masters do not have,
   * and the honest answer to those is a sentence and a usable cascade — not a
   * blanked one. So:
   *
   *   NO STATE AT ALL -> nothing is written and nothing is loaded. The provider
   *     could not place the address in any state we have, the control's own
   *     status line says which one it named, and the form is exactly as it was.
   *     Clearing it would throw away a good answer because a third party did
   *     not recognise a new one.
   *
   *   A STATE BUT NO TOWN -> the state is written, and the town is cleared ONLY
   *     if the state actually moved. A town in the old state really is wrong
   *     then (`onHomeStateChange`'s comment: wrong, not merely unlisted). If
   *     the state did not move, the town already there is still valid data and
   *     stays — the control's status line asks them to check the boxes.
   *
   *   A STATE AND A TOWN -> both written. This is the ordinary case.
   *
   * ⚠️ AND A VALUE THAT DID NOT CHANGE IS NOT WRITTEN AT ALL, so a resolve that
   * confirms what was already on screen does not arm Save. `set()` marks the
   * card dirty unconditionally, which is right for a real edit and wrong for a
   * search that agreed with the form.
   *
   * ----------------------------------------------------------------------------
   * 🔴 THE `onHome*Change` HANDLERS ARE NOT CALLED, AND MUST NOT BE
   * ----------------------------------------------------------------------------
   * Each of them clears the level below it — that is their whole job as cascade
   * rules. `onHomeStateChange(resolved.stateId)` would wipe the very town this
   * method was called to fill in. What is reused instead is the plumbing those
   * handlers share with `applyHomeLocation`: `loadDistricts`,
   * `loadCitiesForDistrict` and `districtOfCity`, in the same order and through
   * the same `onSettled` callbacks.
   *
   * ----------------------------------------------------------------------------
   * 🔴 NO TEHSIL AND NO VILLAGE IS WRITTEN ANYWHERE
   * ----------------------------------------------------------------------------
   * `resolved` carries `tehsilId`, `areaOrVillage`, `addressLine1`, `pincode`
   * and coordinates. `t_app_teachers` has CurrentCityId and CurrentStateId and
   * nothing else — 036_alter_address_columns.sql gave the finer columns to
   * schools, to branches and to preferred locations, and deliberately not to
   * the teacher row — so `UpdateTeacherProfileBody` has nowhere to put them and
   * no control is added for them. Stashing a tehsil in a signal "for later"
   * would be a value the server drops, which is this file's oldest rule: a
   * field the server ignores is a field somebody will one day expect it to
   * honour.
   *
   * ⚠️ WHICH IS THE ONE THING NOBODY IS TOLD ANY MORE. `<ui-address-search>`
   * says what could not be MATCHED (`unmatched`), because that is true on every
   * form. It cannot say what this particular form has nowhere to KEEP — only
   * the host knows that — so a teacher who searched a full street address is no
   * longer told that the sector and the pincode were dropped. See the report:
   * it wants a `keeps`-style input on the shared control, not a second live
   * region here saying a different thing two inches away.
   */
  protected onHomeAddressResolved(resolved: ResolvedAddress): void {
    const draft = this.draft();
    const stateId = resolved.stateId;

    /*
      A state our masters do not have — or no draft to write into yet. The
      control's own status line names what the provider said, the three
      dropdowns are untouched and usable, and nothing here pretends to have
      learned anything.
    */
    if (draft === null || stateId === null) return;

    const stateMoved = draft.currentStateId !== stateId;

    // The town that will be in the box when this is done. See the 🔴 above.
    const cityId = resolved.cityId ?? (stateMoved ? null : draft.currentCityId);

    if (stateMoved) {
      this.set('currentStateId', stateId, 'salary');
    }

    if (draft.currentCityId !== cityId) {
      this.set('currentCityId', cityId, 'salary');
    }

    // The UI-only levels are rebuilt from the state down.
    this.homeDistrictId.set(null);
    this.homeDistricts.set([]);
    this.homeCities.set([]);

    this.loadDistricts(stateId, this.homeDistricts, () => {
      /*
        ⚠️ THE DISTRICT IS PLACED INSIDE THIS CALLBACK, NOT BESIDE THE CALL.
        `onSettled` is what guarantees the list is in before the id is applied,
        which is the ordering rule the whole of `applyLocations` is built on —
        and it runs on failure too, so a dropped district list leaves the state
        and the town alone instead of silently discarding them.
      */
      this.placeHomeDistrict(cityId, resolved);
    });
  }

  /**
   * Which district the cascade has to be shown through, and its town list.
   *
   * ----------------------------------------------------------------------------
   * 🔴 THE DISTRICT FOLLOWS THE TOWN, AND ONLY FALLS BACK ON THE RESOLVE
   * ----------------------------------------------------------------------------
   * The town list is fetched per district, so the district shown must be the one
   * whose list CONTAINS the town in the box — otherwise the City combobox
   * renders empty for a value it has. That gives one rule with two sources:
   *
   *   A TOWN THE RESOLVE PRODUCED -> the resolve's own district, free. The
   *     server matches top down (state, then district in that state, then
   *     tehsil in that district, then town under `tehsilId ?? districtId`), so
   *     a `cityId` always arrives with the `districtId` it was matched beneath;
   *     and 039_m_mdm_tehsil.sql asserts a town's tehsil belongs to that town's
   *     district, so `city?parentId=<districtId>` holds the town whichever of
   *     the two parents matched it. Correct by construction.
   *
   *   A TOWN THAT WAS ALREADY THERE -> `districtOfCity`, the same resolver a
   *     page load uses. The resolve's district belongs to the address they
   *     searched for, not to the town in the box, and using it would hide the
   *     town behind a list that does not contain it.
   *
   *   NO TOWN -> the resolve's district, with its towns loaded, which is the
   *     most useful place to leave somebody: one pick finishes the address the
   *     search could only get part of the way through.
   *
   * ⚠️ WHY THE FREE ANSWER IS WORTH PREFERRING: `districtOfCity` derives the
   * district from the UNPARENTED town master — every town in the country, about
   * 900 rows today and several thousand once the remaining states are seeded.
   * `applyHomeLocation` pays that on a page load, cached, with nobody watching.
   * Here somebody has just clicked a suggestion and is waiting on it.
   */
  private placeHomeDistrict(cityId: number | null, resolved: ResolvedAddress): void {
    const resolvedDistrictId = resolved.districtId;

    // No town, or a town this very resolve produced: the resolve's district.
    if (cityId === null || cityId === resolved.cityId) {
      if (resolvedDistrictId === null) return;

      this.homeDistrictId.set(resolvedDistrictId);
      this.loadCitiesForDistrict(resolvedDistrictId, this.homeCities);
      return;
    }

    // A town that was already in the box, placed the way a page load places it.
    this.districtOfCity(cityId, (derived) => {
      /*
        🔴 A TOWN THAT CANNOT BE PLACED IS STILL KEPT. It is in the draft and it
        stays there: the City box simply does not appear, and the next Save
        sends the town it already had. Dropping it to tidy the screen would
        rewrite a specific town as "anywhere in this state" — the same data loss
        `applyPlaces` carries this comment about.
      */
      if (derived === null) return;

      this.homeDistrictId.set(derived);
      this.loadCitiesForDistrict(derived, this.homeCities);
    });
  }

  // ---- where you want to work ----------------------------------------------

  protected addPlace(): void {
    this.places.update((places) => [...places, newPlace()]);
    this.markDirty('locations');
  }

  protected removePlace(place: PreferredPlace): void {
    this.places.update((places) => places.filter((p) => p.key !== place.key));
    this.markDirty('locations');
  }

  /** CASCADE RULE: as the own location — a new state invalidates all of it. */
  protected onPlaceStateChange(place: PreferredPlace, stateId: number | null): void {
    place.stateId.set(stateId);
    place.districtId.set(null);
    place.cityId.set(null);
    place.tehsilId.set(null);
    place.districts.set([]);
    place.cities.set([]);
    place.tehsils.set([]);

    if (stateId !== null) {
      this.loadDistricts(stateId, place.districts);
    }

    this.markDirty('locations');
  }

  /** CASCADE RULE: a new district clears town and tehsil, and reloads towns. */
  protected onPlaceDistrictChange(place: PreferredPlace, districtId: number | null): void {
    place.districtId.set(districtId);
    place.cityId.set(null);
    place.tehsilId.set(null);
    place.cities.set([]);
    place.tehsils.set([]);

    if (districtId !== null) {
      this.loadCitiesForDistrict(districtId, place.cities);
    }

    this.markDirty('locations');
  }

  /**
   * CASCADE RULE: the town is the tehsil's parent now.
   *
   * 🔴 CLEARING THE TOWN CLEARS THE TEHSIL TOO, and that is not tidiness. A
   * tehsil is a child of the town in this order; kept behind a cleared town it
   * would be a value with no parent, saved against "anywhere in this state" —
   * a narrower claim than the teacher just made.
   *
   * ⚠️ AND A NEW TOWN DOES NOT KEEP THE OLD TEHSIL EITHER. The tehsil list is
   * refetched for the new town, and a tehsil from the previous one is not in
   * it. There is no name-matching and no carrying-over here: `m_mdm_city`'s
   * own `TehsilId` is the authoritative link, and guessing at it by name would
   * be a coincidence standing in for a foreign key.
   */
  protected onPlaceCityChange(place: PreferredPlace, cityId: number | null): void {
    place.cityId.set(cityId);
    place.tehsilId.set(null);
    place.tehsils.set([]);

    if (cityId !== null) {
      this.loadTehsilsForCity(cityId, place.tehsils);
    }

    this.markDirty('locations');
  }

  protected onPlaceTehsilChange(place: PreferredPlace, tehsilId: number | null): void {
    place.tehsilId.set(tehsilId);
    this.markDirty('locations');
  }

  /** Whether a row's state has any town worth narrowing to. */
  protected placeHasDistricts(place: PreferredPlace): boolean {
    return place.districts().length > 0;
  }

  protected placeHasCities(place: PreferredPlace): boolean {
    return place.cities().length > 0;
  }

  protected placeHasTehsils(place: PreferredPlace): boolean {
    return place.tehsils().length > 0;
  }

  /**
   * What goes on the wire.
   *
   * ----------------------------------------------------------------------------
   * 🔴 THE SHAPE IS UNCHANGED: cityId, stateId, preferenceOrder (2.47/2.54).
   * ----------------------------------------------------------------------------
   * Reordering the CONTROLS changed nothing about what a row means. A row with
   * a town saves that town; a row with only a state saves `cityId: null`,
   * which means "anywhere in this state" and is a real preference rather than
   * a gap. The endpoint still receives the COMPLETE set.
   *
   * ⚠️ A ROW WITH NO STATE IS NOT A PREFERENCE. The picker starts with one
   * empty row so it reads as a control rather than a bare button, and an
   * untouched one must not become "anywhere in nowhere".
   *
   * ⚠️ DUPLICATES COLLAPSE HERE, KEEPING THE FIRST. The target's unique index
   * is (TeacherId, CityId, StateId) and USP_SaveTeacherPreferredLocations
   * already does `GROUP BY CityId, StateId` taking `MIN(PreferenceOrder)`.
   * Doing it here as well is not duplication of that rule, it is agreement
   * with it: it keeps preferenceOrder contiguous 1..n, so the order the
   * teacher set is the order that comes back after the re-read.
   *
   * 🔴 tehsilId IS DELIBERATELY NOT SENT. `TeacherLocation` has no such field
   * (nor does the TVP, nor the procedure). The one line to add the day they do
   * is here, next to cityId — and it must land in the SAME change as the
   * tehsil-by-city master, or the control starts eating a choice. See
   * `loadTehsilsForCity`.
   */
  private preferredLocationsToSave(): TeacherLocation[] {
    const seen = new Set<string>();
    const locations: TeacherLocation[] = [];

    for (const place of this.places()) {
      const stateId = place.stateId();
      if (stateId === null) continue;

      const cityId = place.cityId();

      const identity = `${stateId}:${cityId ?? 'any'}`;
      if (seen.has(identity)) continue;
      seen.add(identity);

      locations.push({ cityId, stateId, preferenceOrder: locations.length + 1 });
    }

    return locations;
  }

  // ---- re-opening what was saved -------------------------------------------

  /**
   * Puts the saved geography back on screen.
   *
   * ----------------------------------------------------------------------------
   * 🔴 A SAVED ID IS APPLIED ONLY AFTER THE LIST THAT CONTAINS IT HAS ARRIVED
   * ----------------------------------------------------------------------------
   * `<ui-combobox>` shows `selected()?.label`, computed over `options()` — so
   * a value whose option is missing renders as an EMPTY FIELD. It is not
   * cleared, and it does re-appear if the list arrives later, but "blank for a
   * valid saved value" is indistinguishable from "we lost it" to the person
   * reading the screen.
   *
   * So every level is loaded by the callback of the one above it, and the id
   * is set inside that callback. The chain per row is:
   *
   *     state (already loaded) -> districts -> saved city's district
   *       -> cities -> saved city -> tehsils -> saved tehsil
   *
   * ⚠️ THE DISTRICT IS DERIVED, NOT READ BACK, because
   * `t_app_teacher_preferred_locations` has no DistrictId and should not: a
   * town determines its district. That derivation is the extra hop in the
   * chain above, and it has to finish before the town list can even be asked
   * for. See `districtOfCity`.
   *
   * ⚠️ THE ONE EXCEPTION IS THE STATE, and it is only an exception on paper.
   * The state master is unparented and fetched in the constructor, so there is
   * no parent to wait for — the two requests race, and the combobox fills in
   * whichever order they land, because `selected` is a computed over the
   * options input. Everything below the state has a parent, and therefore an
   * order that must be kept.
   */
  private applyLocations(profile: TeacherProfile): void {
    this.applyHomeLocation(profile);
    this.applyPlaces(profile);
  }

  private applyHomeLocation(profile: TeacherProfile): void {
    /*
      ⚠️ NOTHING CLEARS THE SEARCH BOX HERE ANY MORE, AND IT CANNOT FROM HERE.
      `<ui-address-search>` owns its own text and exposes no reset, so after a
      conflict reload the box still reads back the address that was searched
      while these three dropdowns snap to the saved values. Cosmetic, and only
      on that one path — but it is in the report, because the fix belongs to the
      shared control, not to a second copy of its state in this file.
    */
    this.homeDistrictId.set(null);
    this.homeDistricts.set([]);
    this.homeCities.set([]);

    const stateId = profile.currentStateId;
    const cityId = profile.currentCityId;

    if (stateId !== null) {
      this.loadDistricts(stateId, this.homeDistricts);
    }

    if (cityId === null) return;

    /*
      ⚠️ The town's own value is in the draft and was set by `apply()` — this
      is the LIST it needs, fetched through the district it had to be placed in
      first. Nothing here writes `currentCityId`; writing it would mark the
      section dirty on a plain page load and arm the Save button over an edit
      nobody made.

      ⚠️ WHICH ALSO MEANS A TOWN THAT CANNOT BE PLACED IS KEPT, for free: the
      draft still holds it, so the field reads blank but the next Save sends
      the same town back. The row picker has to do that explicitly — see the
      matching comment in `applyPlaces`.
    */
    this.districtOfCity(cityId, (districtId) => {
      if (districtId === null) return;

      this.homeDistrictId.set(districtId);
      this.loadCitiesForDistrict(districtId, this.homeCities);
    });
  }

  private applyPlaces(profile: TeacherProfile): void {
    /*
      ⚠️ SORTED BY preferenceOrder, not taken in arrival order. "First
      preference" is a value in the row, not a position in the array — and the
      row order on screen is what this screen writes back as that value, so
      reading it from anywhere else would let the two drift.
    */
    const saved = [...profile.preferredLocations].sort(
      (a, b) => a.preferenceOrder - b.preferenceOrder,
    );

    /*
      ⚠️ ONE EMPTY ROW WHEN THERE IS NOTHING SAVED, so the section reads as a
      control rather than as a button next to an explanation. It saves nothing
      by itself (see `preferredLocationsToSave`) and marks nothing dirty.
    */
    if (saved.length === 0) {
      this.places.set([newPlace()]);
      return;
    }

    const places = saved.map((location) => newPlace(location.stateId));
    this.places.set(places);

    saved.forEach((location, index) => {
      const place = places[index];
      if (place === undefined) return;

      this.loadDistricts(location.stateId, place.districts);

      const cityId = location.cityId;
      if (cityId === null) return;

      this.districtOfCity(cityId, (districtId) => {
        /*
          🔴 A TOWN THAT CANNOT BE PLACED IS STILL KEPT.

          The town master was unreachable, or no longer has this row. Either
          way the row keeps the town it was saved with: the field reads blank
          until the list can be fetched again, which is ugly, and dropping it
          instead would make the next Save rewrite "Sonipat town" as "anywhere
          in Haryana" without anybody asking for it.
        */
        if (districtId === null) {
          place.cityId.set(cityId);
          return;
        }

        place.districtId.set(districtId);

        this.loadCitiesForDistrict(districtId, place.cities, () => {
          place.cityId.set(cityId);

          /*
            ⚠️ Loaded for a re-opened row as well as a freshly picked one, so a
            row does not change shape after a reload. It costs one request per
            saved town — cached per parent by `MasterService` — and today every
            one of them comes back empty, which is why no tehsil control
            appears on this screen yet. The saved tehsil would be applied in
            this callback, the day `TeacherLocation` carries one.
          */
          this.loadTehsilsForCity(cityId, place.tehsils);
        });
      });
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

/**
 * A fresh preferred-location row.
 *
 * ⚠️ MODULE-SCOPED, NOT A METHOD, because it touches no injected service — and
 * because `computed()` needs no injection context, unlike `effect()`. Keeping
 * it out of the class makes it obvious that building a row cannot fire a
 * request: every list starts empty and is filled by the cascade.
 */
function newPlace(stateId: number | null = null): PreferredPlace {
  const districts = signal<Lookup[]>([]);
  const cities = signal<Lookup[]>([]);
  const tehsils = signal<Lookup[]>([]);

  return {
    key: ++nextPlaceKey,
    stateId: signal(stateId),
    districtId: signal<number | null>(null),
    cityId: signal<number | null>(null),
    tehsilId: signal<number | null>(null),
    districts,
    cities,
    tehsils,

    // The per-row `computed`s the interface's comment is about. They close over
    // this row's own signals, so one row's options never change identity
    // because another row did.
    districtOptions: computed(() => lookupsToOptions(districts())),
    cityOptions: computed(() => lookupsToOptions(cities())),
    tehsilOptions: computed(() => lookupsToOptions(tehsils())),
  };
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
