// src/utils/nav.ts
// Tiny hash router: keeps the teacher's exact screen across refreshes.
// Routes:
//   #/                                        → home (circles list)
//   #/circle/:ringId                          → circle dashboard
//   #/circle/:ringId/recitation/:studentId    → circle + recitation sheet open
//   #/circle/:ringId/student/:studentId/mushaf → dedicated full-screen Mushaf view
//   #/circle/:ringId/student/:studentId/plan   → dedicated full-screen student plan
//   #/mushaf                                  → standalone full Mushaf reader (المصحف الكامل)
//   #/mushaf/:page                            → the reader opened on a given page

export type Route =
  | { view: 'home' }
  | { view: 'circle'; ringId: number; recitationStudentId?: number | null }
  | { view: 'mushaf'; ringId: number; studentId: number }
  | { view: 'plan'; ringId: number; studentId: number }
  | { view: 'reader'; page?: number };

export function parseRoute(hash: string): Route {
  const h = (hash || '').replace(/^#\/?/, ''); // strip leading '#/' or '#'
  const parts = h.split('/').filter(Boolean);

  // #/mushaf أو #/mushaf/:page — القارئ المستقلّ (بلا طالب)
  if (parts[0] === 'mushaf') {
    const p = parts[1] ? Number(parts[1]) : NaN;
    return { view: 'reader', page: Number.isFinite(p) && p >= 1 ? p : undefined };
  }

  if (parts[0] === 'circle' && parts[1]) {
    const ringId = Number(parts[1]);
    if (Number.isFinite(ringId)) {
      // #/circle/:ringId/student/:studentId/mushaf | .../plan
      if (parts[2] === 'student' && parts[3] && (parts[4] === 'mushaf' || parts[4] === 'plan')) {
        const studentId = Number(parts[3]);
        if (Number.isFinite(studentId)) {
          return { view: parts[4] === 'plan' ? 'plan' : 'mushaf', ringId, studentId };
        }
      }
      // #/circle/:ringId/recitation/:studentId
      const recPart = parts[2] === 'recitation' && parts[3] ? Number(parts[3]) : null;
      return {
        view: 'circle',
        ringId,
        recitationStudentId: recPart !== null && Number.isFinite(recPart) ? recPart : null,
      };
    }
  }
  return { view: 'home' };
}

export const homeHash = () => '#/';
export const circleHash = (ringId: number) => `#/circle/${ringId}`;
export const recitationHash = (ringId: number, studentId: number) =>
  `#/circle/${ringId}/recitation/${studentId}`;
export const mushafHash = (ringId: number, studentId: number) =>
  `#/circle/${ringId}/student/${studentId}/mushaf`;
export const planHash = (ringId: number, studentId: number) =>
  `#/circle/${ringId}/student/${studentId}/plan`;
export const readerHash = (page?: number) => (page && page > 1 ? `#/mushaf/${page}` : '#/mushaf');

// Write a hash (replace keeps history clean for programmatic nav).
export function navigate(hash: string) {
  if (window.location.hash === hash) return;
  window.location.hash = hash;
}

export function currentHash(): string {
  return window.location.hash || '#/';
}
