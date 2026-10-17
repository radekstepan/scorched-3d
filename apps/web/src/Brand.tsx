import { APP_NAME } from "@scorched-3d/core";

/** Workshop identity from the sibling redesign-stumpy-tank-model project. */
export default function Brand() {
  return (
    <div className="command-brand" role="img" aria-label={APP_NAME}>
      <svg className="brand-mark" width="35" height="37" viewBox="0 0 36 40" fill="none" aria-hidden="true">
        <path d="M18 1 34 10v19L18 39 2 29V10L18 1Z" stroke="currentColor" strokeWidth="1.5" />
        <path d="m18 7 10 6-10 6-10-6 10-6Zm-10 9 7 4v12l-7-4V16Zm20 0-7 4v12l7-4V16Z" fill="currentColor" />
      </svg>
      <div aria-hidden="true">
        <strong>SCORCHED<span className="brand-3d">3D</span></strong>
        <small>TACTICAL WARFARE. REFORGED.</small>
      </div>
    </div>
  );
}
