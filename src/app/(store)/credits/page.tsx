const photos = [
  ["Cozy living room", "Gabriela Pons", "cozy-living-room-design-with-warm-light-7851906"],
  ["Lounge chair", "Max Vakhtbovych", "white-lounge-chair-7587748"],
  ["Headphones", "Sound On", "white-headphones-3394652"],
  ["Globe lamp", "Kaboompics", "a-white-lamp-over-a-marble-top-table-6825312"],
  ["Commuter bag", "Collab Media", "hand-of-unrecognizable-person-putting-laptop-in-leather-bag-on-a-beige-background-15059375"],
  ["Ceramic mug", "Ivan Vi", "mug-with-handle-20843712"],
  ["Compact camera", "Olena Bohovyk", "black-camera-on-white-surface-3646163"],
  ["Desktop speaker", "Josh Sorenson", "modern-music-speaker-on-table-at-home-1714206"],
  ["Mesh watch", "Márcio Carvalho", "close-up-of-wristwatch-25482574"],
];
export const metadata = { title: "Photography credits" };
export default function CreditsPage() { return <main id="main" className="page-frame credits-page"><h1>Behind the photographs.</h1><p>Thank you to the photographers whose work gives this preview its texture and warmth.</p><p>These stock images illustrate a sample collection. They are not actual Cartiva inventory or endorsements.</p><ul>{photos.map(([title, author, slug]) => <li key={slug}><a href={`https://www.pexels.com/photo/${slug}/`} target="_blank" rel="noreferrer">{title}<span>{author} · Pexels ↗</span></a></li>)}</ul><p>The original stock photography is used under the <a href="https://www.pexels.com/license/" target="_blank" rel="noreferrer">Pexels License</a>. Jost and Bodoni Moda are self-hosted under the SIL Open Font License.</p></main>; }
