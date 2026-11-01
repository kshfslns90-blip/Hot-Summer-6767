// Which project a page belongs to, and how it reaches it. In the designer the page is
// /ide/<id> and every call to the project goes through the designer at /p/<id>/...; on a
// project's own preview origin nothing is prefixed - the origin is the project - so the helpers
// here are identities there. The runtime imports this too, for pictures.
const m = /^\/ide\/([0-9a-f]{16})(?:\/|$)/.exec(typeof location === 'undefined' ? '' : location.pathname);

export const projectId = m ? m[1] : '';
export const inDesigner = Boolean(projectId);

// `/p/<id>/api...` in the designer; `/api...` (or `/images...`) on a preview origin.
export function projectUrl(kind, rest = '') {
  return `${inDesigner ? `/p/${projectId}` : ''}/${kind}${rest}`;
}

// A stored picture reference (/images/<name>) displayed where the page is: through the
// designer's proxy in the IDE, as is on the project's origin. Any other value is left alone.
export function imageSrc(value) {
  if (!inDesigner || typeof value !== 'string') return value;
  return value.startsWith('/images/') ? `/p/${projectId}${value}` : value;
}
