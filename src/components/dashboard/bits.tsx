export function Flash({ ok, err }: { ok?: string; err?: string }) {
  if (err)
    return (
      <div className="flash err" role="alert">
        {err}
      </div>
    );
  if (ok)
    return (
      <div className="flash ok" role="status">
        {ok}
      </div>
    );
  return null;
}

/** Where a server action should redirect back to after it runs. */
export function BackField({ value }: { value: string }) {
  return <input type="hidden" name="back" value={value} />;
}

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="dash-top">
      <div>
        <h1>{title}</h1>
        {sub ? <div className="muted">{sub}</div> : null}
      </div>
      {children ? <div className="toolbar">{children}</div> : null}
    </div>
  );
}
