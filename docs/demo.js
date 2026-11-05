// Replaces the studio's server with made-up data, so the page can run on GitHub Pages.
window.CROAK_DEMO = true;

const sampleDrafts = () => [
  {
    builder: 'marsh-maker',
    title: 'Teaching a Workflow to Water My Greenhouse',
    storyType: 'feed',
    status: 'waiting for approval',
    sourceUrl: 'https://example.com/greenhouse',
    draft: 'marsh-maker wrote about using a Swamp workflow to water a small greenhouse. Soil readings decide when each bed gets water, and every run leaves a record to review later.\n\nhttps://example.com/greenhouse',
    imageCaption: 'marsh-maker shares a Swamp workflow that waters a small greenhouse.',
    notes: ['This is made-up sample text.', 'Check the soil details against the source.'],
    sourceText: 'Teaching a Workflow to Water My Greenhouse\nThis sample post describes a small greenhouse. Soil readings decide when each bed gets water, and every run leaves a record that can be reviewed later.',
  },
  {
    builder: 'reed-runner',
    title: 'A Swamp Workflow for My Weekly Newsletter',
    storyType: 'feed',
    status: 'waiting for approval',
    sourceUrl: 'https://example.com/newsletter',
    draft: 'reed-runner built a Swamp workflow that gathers links for a weekly newsletter and leaves the final choice to a person.\n\nhttps://example.com/newsletter',
    imageCaption: 'reed-runner uses a Swamp workflow to gather links for a weekly newsletter.',
    notes: ['This is made-up sample text.'],
    sourceText: 'A Swamp Workflow for My Weekly Newsletter\nThis sample post describes a workflow that gathers links for a weekly newsletter. A person makes the final choice.',
  },
  {
    builder: 'lilypad-lab',
    title: '@lilypad-lab/recipe-box',
    storyType: 'registry',
    status: 'failed checks',
    sourceUrl: 'https://example.com/recipe-box',
    draft: 'lilypad-lab published recipe-box, which has saved 500 recipes for swamp users.\n\nhttps://example.com/recipe-box',
    imageCaption: 'lilypad-lab shares a small extension for organizing recipes.',
    notes: ['This is made-up sample text.', 'The number 500 is not in the source.', 'The draft uses lowercase "swamp" in prose.'],
    sourceText: '@lilypad-lab/recipe-box\nThis sample extension organizes recipes.',
  },
].map(draft => ({ ...draft, inputTokens: 0, outputTokens: 0, approvedAt: null }));

const demo = { drafts: sampleDrafts(), skip: ['swamp'], imageCount: 0, draftedAt: new Date().toISOString() };
const find = builder => demo.drafts.find(draft => draft.builder === builder);
const breaksRules = text => /\b500\b/.test(text) || /\bswamp\b/.test(text.replace(/https?:\/\/\S+/g, ' '));

const actions = {
  '/api/state': () => [200, { ...demo, model: 'Sample data', dryRun: false, running: false }],
  '/api/run': () => {
    demo.drafts = sampleDrafts();
    demo.draftedAt = new Date().toISOString();
    return [200, { status: 'succeeded' }];
  },
  '/api/approve': ({ builder, text }) => {
    const draft = find(builder);
    const final = text ?? draft.draft;
    if (breaksRules(final)) return [400, { error: 'The draft fails its checks. Remove the 500 and write Swamp with a capital S, then try again.' }];
    Object.assign(draft, { draft: final, status: 'approved', approvedAt: new Date().toISOString() });
    return [200, { ok: true }];
  },
  '/api/reject': ({ builder, reason }) => {
    if (!reason?.trim()) return [400, { error: 'Give a reason for rejecting this draft.' }];
    const draft = find(builder);
    Object.assign(draft, { status: 'rejected', notes: [...draft.notes, `Rejected: ${reason.trim()}`] });
    return [200, { ok: true }];
  },
  '/api/skip': ({ add, remove }) => {
    if (add && !/^[\w.-]+$/.test(add)) return [400, { error: 'Use letters, numbers, dots, dashes or underscores.' }];
    if (add && !demo.skip.includes(add)) demo.skip.push(add);
    if (remove) demo.skip = demo.skip.filter(name => name !== remove);
    return [200, { skip: demo.skip }];
  },
  '/api/save': () => {
    demo.imageCount += 1;
    return [200, { saved: 'browser' }];
  },
};

const realFetch = window.fetch.bind(window);
window.fetch = async (url, options = {}) => {
  const action = actions[String(url)];
  if (!action) return realFetch(url, options);
  await new Promise(resolve => setTimeout(resolve, 250));
  const [status, body] = action(options.body ? JSON.parse(options.body) : {});
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
};
