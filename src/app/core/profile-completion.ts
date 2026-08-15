import { TeacherProfile } from './teacher.service';

/**
 * Which section a suggestion points at, so the screen can scroll to it.
 */
export type ProfileSection =
  | 'basics'
  | 'photo'
  | 'qualifications'
  | 'subjects'
  | 'skills'
  | 'experience'
  | 'locations'
  | 'salary'
  | 'documents';

export interface NextStep {
  /** What to do, in the imperative. Shown as the headline. */
  title: string;

  /** Why it is worth doing — the reason, not the reward. */
  why: string;

  section: ProfileSection;

  /** How many points it adds, for the "+20" hint. */
  points: number;
}

/*==============================================================================
  🔴 THE PERCENTAGE COMES FROM THE SERVER. THIS FILE DOES NOT COMPUTE IT.

  USP_RecalculateTeacherProfile owns the number (2.54) and rewrites it on every
  change. `profileCompletionPercent` is read and displayed as-is.

  What this file decides is WHICH MISSING THING TO NAME, which is a different
  question and one only the screen cares about. If these weights ever drift from
  the procedure's, the bar still shows the truth — only the suggestion order
  would be off.

  The rule, from 2.54:
      resume 25 · subjects 20 · experience 15 · photo 10
      designation 5 + qualification 5 · about (≥40 chars) 8 · locations 7
      class levels 5
      🔴 capped at 75 while there is no resume
==============================================================================*/

/** The cap that applies until a resume is uploaded (2.54). */
export const NO_RESUME_CAP = 75;

/** An "about" shorter than this does not count — it is a placeholder, not a paragraph. */
const ABOUT_MIN_LENGTH = 40;

/**
 * What to suggest next, in the order a teacher should actually do it.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ NOT ORDERED BY POINTS. ORDERED BY VALUE PER EFFORT.
 * ----------------------------------------------------------------------------
 * The resume is worth the most (25) and is the biggest ask — a file somebody
 * has to find, and often write. Subjects are worth 20 and take two taps, and
 * until they are set the teacher does not appear in a single school's search.
 * Sending somebody to hunt for a PDF as the very first thing they are asked to
 * do is how a profile gets abandoned at 0%.
 *
 * So subjects lead, experience follows, and the resume is named as soon as the
 * quick wins are done — and named LOUDLY at 75%, where it is the only thing
 * that moves the bar at all.
 */
const STEPS: readonly {
  section: ProfileSection;
  points: number;
  title: string;
  why: string;
  done: (profile: TeacherProfile) => boolean;
}[] = [
  {
    section: 'subjects',
    points: 20,
    title: 'Add the subjects you teach',
    why: 'Schools search by subject. Until you pick yours, none of their searches can find you.',
    done: (p) => p.subjectIds.length > 0,
  },
  {
    section: 'experience',
    points: 15,
    title: 'Add where you have taught',
    why: 'This is the first thing a principal reads. Even one school with dates is worth more than a full profile without it.',
    done: (p) => p.experiences.length > 0,
  },
  {
    section: 'documents',
    points: 25,
    title: 'Upload your resume',
    why: 'It is the single biggest thing you can add, and your profile cannot go past 75% without it.',
    done: (p) => !!p.resumePath,
  },
  {
    section: 'qualifications',
    points: 10,
    title: 'Add your qualification and what you are hired as',
    why: 'Schools filter on both. "B.Ed, PGT" is often the whole shortlisting decision.',
    done: (p) => !!p.qualificationId && !!p.designationId,
  },
  {
    section: 'photo',
    points: 10,
    title: 'Add a photo',
    why: 'Profiles with a photo are opened far more often. An ordinary one taken today is fine.',
    done: (p) => !!p.photoPath,
  },
  {
    section: 'locations',
    points: 7,
    title: 'Say where you want to work',
    why: 'Schools filter by area. Without this you show up in searches for places you would never travel to, and miss the ones next door.',
    done: (p) => p.preferredLocations.length > 0,
  },
  {
    section: 'basics',
    points: 8,
    title: 'Write a few lines about yourself',
    why: 'A principal reads this before deciding whether to call. Say what you teach well and what you are looking for.',
    done: (p) => (p.aboutMe ?? '').trim().length >= ABOUT_MIN_LENGTH,
  },
  {
    section: 'subjects',
    points: 5,
    title: 'Add the classes you can teach',
    why: 'A primary post and a senior-secondary post are different jobs. This keeps you out of the wrong shortlists.',
    done: (p) => p.classLevelIds.length > 0,
  },
];

/**
 * The single highest-value thing this teacher has not done, or null when the
 * profile is complete.
 *
 * 🔴 ONE suggestion, not a checklist. A list of eight things left to do is a
 * list somebody closes; one clear next step with a reason is one they act on.
 */
export function nextStep(profile: TeacherProfile | null): NextStep | null {
  if (profile === null) return null;

  const pending = STEPS.filter((step) => !step.done(profile));

  if (pending.length === 0) return null;

  /*
    🔴 AT THE CAP, THE RESUME IS THE ONLY ANSWER.

    Somebody who has done everything else sits at 75% and watches the bar stop
    moving. Suggesting "add a photo" there would be true and useless — the photo
    is already counted and the number would not change. A bar that stops with no
    explanation reads as broken.
  */
  if (!profile.resumePath && profile.profileCompletionPercent >= NO_RESUME_CAP) {
    return STEPS.find((step) => step.section === 'documents') ?? pending[0];
  }

  return {
    title: pending[0].title,
    why: pending[0].why,
    section: pending[0].section,
    points: pending[0].points,
  };
}

/**
 * Whether the bar is being held at 75 by a missing resume.
 *
 * ⚠️ Read where it BITES rather than explained in a tooltip: a teacher at 75%
 * who has filled in everything else needs to be told why nothing they do moves
 * the number.
 */
export function isHeldByResumeCap(profile: TeacherProfile | null): boolean {
  return profile !== null && !profile.resumePath && profile.profileCompletionPercent >= NO_RESUME_CAP;
}

/**
 * The encouraging half of the message — what is already done.
 *
 * At 0% this says nothing rather than "0 of 8", because being told you have
 * achieved nothing is where people close the tab.
 */
export function completedCount(profile: TeacherProfile | null): number {
  if (profile === null) return 0;

  return STEPS.filter((step) => step.done(profile)).length;
}

export const TOTAL_STEPS = STEPS.length;
