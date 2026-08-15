import React from 'react';
import { CircleCheck, CircleX, CircleDashed, TriangleAlert, FileCode2, AppWindow } from 'lucide-react';
import { cn } from '../lib/cn';
import type { FinalReceipt as FinalReceiptModel, ReceiptClaim } from '../final.receipt.model';

/**
 * The final receipt: claim → evidence, across both lanes of a Bimax task.
 *
 * `08_ACCEPTANCE_GATES.md` forbids an evidence gap producing an unqualified safe verdict, so an
 * unproven claim renders as unproven WITH its gap rather than being hidden to make the card green.
 */
export function FinalReceipt({ receipt }: { receipt: FinalReceiptModel }): React.ReactElement {
  if (receipt.claims.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line px-3 py-5 text-center text-[11.5px] text-faint">
        {receipt.summary}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <section
        className={cn(
          'shrink-0 rounded-xl border px-3 py-2.5',
          receipt.complete ? 'border-moss/35 bg-moss/8' : 'border-amber/35 bg-amber/8',
        )}
      >
        <div className="flex items-center gap-2">
          {receipt.complete
            ? <CircleCheck size={15} className="text-moss" />
            : <TriangleAlert size={15} className="text-amber" />}
          <span className="text-[13px] font-semibold text-ink">
            {receipt.complete ? 'Everything Bimax claimed is proven' : 'Some claims are not proven'}
          </span>
        </div>
        <p className={cn('mt-1 text-[11px] leading-relaxed', receipt.complete ? 'text-moss' : 'text-amber')}>
          {receipt.complete
            ? 'Each claim below links to the evidence that confirms it.'
            : 'Bimax will not call these done. The gaps are listed with each claim.'}
        </p>
      </section>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
        {receipt.claims.map((claim) => <ClaimCard key={claim.id} claim={claim} />)}

        {receipt.gaps.length > 0 && (
          <section className="mt-1 rounded-lg border border-line bg-well px-3 py-2">
            <div className="mb-1 text-[10px] font-medium tracking-[0.08em] text-faint uppercase">
              What is still unproven
            </div>
            <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-dim">
              {receipt.gaps.map((gap) => <li key={gap}>{gap}</li>)}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function ClaimCard({ claim }: { claim: ReceiptClaim }): React.ReactElement {
  return (
    <section className="mb-2.5 rounded-lg border border-line bg-raise">
      <header className="flex items-start gap-2 border-b border-line px-3 py-2">
        {claim.proven
          ? <CircleCheck size={13} className="mt-0.5 shrink-0 text-moss" />
          : <CircleDashed size={13} className="mt-0.5 shrink-0 text-amber" />}
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium text-ink">{claim.claim}</div>
          {claim.gap
            ? <div className="mt-0.5 text-[10.5px] text-amber">{claim.gap}</div>
            : <div className="mt-0.5 text-[10.5px] text-moss">Confirmed by the evidence below.</div>}
        </div>
      </header>
      <ul className="px-3 py-1.5">
        {claim.evidence.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex items-start gap-2 py-1 text-[11px]">
            <span className="mt-0.5 shrink-0 text-faint">
              {item.lane === 'code' ? <FileCode2 size={11} /> : <AppWindow size={11} />}
            </span>
            <span className="min-w-0 flex-1 break-words font-mono text-[10.5px] text-dim">{item.label}</span>
            <span
              className={cn(
                'shrink-0 text-[10px]',
                item.ok === true ? 'text-moss' : item.ok === false ? 'text-rust' : 'text-faint',
              )}
            >
              {item.ok === false ? <CircleX size={10} className="mr-1 inline" /> : null}
              {item.detail}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
