/** Markdown shared by the job summary and the pull request comment. */

export interface Finding {
  category: string;
  check: string;
}

export interface ScanDetail {
  categories: { name: string; grade: string; score: number; maxScore: number }[];
  regressed: Finding[];
  fixed: Finding[];
  previous: { grade: string; score: number; date: string } | null;
}

export interface Outcome {
  url: string;
  grade: string;
  score: number;
  scanId: string;
  reportUrl: string;
  /** Null when the account's plan does not include detailed results. */
  detail: ScanDetail | null;
  /** Set when detail is unavailable but the API still reported counts. */
  regressedCount: number | null;
  failed: boolean;
  reasons: string[];
  notes: string[];
}

/** Marker used to find and update this action's own comment. */
export const COMMENT_MARKER = '<!-- websentry-action -->';

function scoreLine(o: Outcome): string {
  const verdict = o.failed ? '❌ Failed' : '✅ Passed';
  return `${verdict} &nbsp; **${o.grade}** &nbsp; ${o.score}/100`;
}

function findingsTable(rows: Finding[]): string {
  const body = rows
    .map(f => `| ${f.category} | ${f.check} |`)
    .join('\n');
  return `| Category | Check |\n| --- | --- |\n${body}`;
}

export function renderReport(o: Outcome): string {
  const parts: string[] = [];

  parts.push('### WebSentry security scan');
  parts.push(`${scoreLine(o)}\n\n\`${o.url}\``);

  if (o.reasons.length > 0) {
    parts.push(o.reasons.map(r => `> ${r}`).join('\n'));
  }

  if (o.detail) {
    const d = o.detail;

    if (d.previous) {
      parts.push(
        `Previous scan: **${d.previous.grade}** ${d.previous.score}/100 on ${d.previous.date}`
      );
    }

    if (d.regressed.length > 0) {
      parts.push(
        `**${d.regressed.length} ${d.regressed.length === 1 ? 'check' : 'checks'} regressed since the previous scan**`
      );
      parts.push(findingsTable(d.regressed));
    } else if (d.previous) {
      parts.push('No checks regressed since the previous scan.');
    }

    if (d.fixed.length > 0) {
      parts.push(`${d.fixed.length} ${d.fixed.length === 1 ? 'check was' : 'checks were'} fixed since the previous scan.`);
    }

    if (d.categories.length > 0) {
      const rows = d.categories
        .map(c => `| ${c.name} | ${c.grade} | ${c.score}/${c.maxScore} |`)
        .join('\n');
      parts.push(
        `<details><summary>Category breakdown</summary>\n\n| Category | Grade | Score |\n| --- | --- | --- |\n${rows}\n\n</details>`
      );
    }
  } else if (o.regressedCount !== null && o.regressedCount > 0) {
    parts.push(
      `**${o.regressedCount} ${o.regressedCount === 1 ? 'check' : 'checks'} regressed since the previous scan.** ` +
        'Upgrade to Pro to see which checks changed, right here in the pull request.'
    );
  }

  for (const note of o.notes) {
    parts.push(`_${note}_`);
  }

  parts.push(`[Full report](${o.reportUrl})`);
  parts.push(COMMENT_MARKER);

  return parts.join('\n\n');
}
