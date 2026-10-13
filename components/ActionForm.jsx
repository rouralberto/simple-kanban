'use client';

import { useActionState } from 'react';

// Form wired to a server action returning { error } / { ok }.
export default function ActionForm({ action, children, submit = 'Save', className = 'stack' }) {
  const [state, formAction, pending] = useActionState(async (prev, fd) => {
    const res = await action(prev, fd);
    return res ?? {};
  }, {});
  return (
    <form action={formAction} className={className}>
      {children}
      {state.error && <p className="error">{state.error}</p>}
      {state.ok && <p className="ok">{state.ok}</p>}
      <button className="primary" disabled={pending}>{pending ? '…' : submit}</button>
    </form>
  );
}
