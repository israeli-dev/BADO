import { FlaskConical } from 'lucide-react';

export function DemoEnvironmentBanner({
  institutionName,
  isLocalSandbox,
}: {
  institutionName: string;
  isLocalSandbox: boolean;
}) {
  return (
    <div
      role="status"
      className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-950"
    >
      <div className="mx-auto flex max-w-7xl items-center gap-2">
        <FlaskConical className="h-4 w-4 shrink-0 text-amber-800" aria-hidden="true" />
        <p className="leading-snug">
          <strong className="font-semibold">Demonstration Environment:</strong>{' '}
          Viewing <span className="font-medium">{institutionName}</span>
          {isLocalSandbox ? ' (local IndexedDB sandbox)' : ''}. All records are
          simulated for training and testing — never use demonstration records for
          real excavation decisions.
        </p>
      </div>
    </div>
  );
}
