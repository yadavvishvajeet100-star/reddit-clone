import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";

type VoteType = "UPVOTE" | "DOWNVOTE";
type PostKind = "text" | "image" | "link";
type SortMode = "latest" | "popular" | "trending";

type User = { id: string; email: string; username: string; passwordHash: string; image?: string; createdAt: string };
type Community = { id: string; name: string; slug: string; description: string; image?: string; createdAt: string };
type Post = { id: string; title: string; content: string; kind: PostKind; imageUrl?: string; linkUrl?: string; communityId: string; authorId: string; createdAt: string };
type Comment = { id: string; content: string; postId: string; authorId: string; createdAt: string };
type Vote = { id: string; type: VoteType; userId: string; postId: string };
type Database = { users: User[]; communities: Community[]; posts: Post[]; comments: Comment[]; votes: Vote[] };

const STORAGE_KEY = "threadline-reddit-clone-db";
const SESSION_KEY = "threadline-session-user";
const now = () => new Date().toISOString();
const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;

const seedDb: Database = {
  users: [
    { id: "user_ada", email: "ada@example.com", username: "ada_admin", passwordHash: "demo", image: "AA", createdAt: "2026-01-02T12:00:00.000Z" },
    { id: "user_mira", email: "mira@example.com", username: "mira_builds", passwordHash: "demo", image: "MB", createdAt: "2026-01-04T12:00:00.000Z" },
  ],
  communities: [
    { id: "com_startups", name: "Startup Founders", slug: "startups", description: "Product launches, growth lessons, and founder operating notes.", createdAt: "2026-01-03T09:00:00.000Z" },
    { id: "com_engineering", name: "Engineering", slug: "engineering", description: "Architecture, code reviews, scaling stories, and system design.", createdAt: "2026-01-04T09:00:00.000Z" },
    { id: "com_design", name: "Product Design", slug: "design", description: "UX critique, interface patterns, and design systems.", createdAt: "2026-01-05T09:00:00.000Z" },
  ],
  posts: [
    { id: "post_launch", title: "What should a Reddit-style MVP ship in the first two weeks?", content: "Keep the first milestone focused on auth, communities, posts, flat comments, voting, sorting, and responsive UI. Real-time features can wait until the model proves itself.", kind: "text", communityId: "com_startups", authorId: "user_ada", createdAt: "2026-01-11T15:30:00.000Z" },
    { id: "post_schema", title: "Prisma schema tip: keep Vote separate from Post", content: "A unique compound index on userId and postId makes duplicate votes impossible and keeps toggling logic explicit. You can aggregate score in queries or cache it later.", kind: "text", communityId: "com_engineering", authorId: "user_mira", createdAt: "2026-01-12T10:15:00.000Z" },
    { id: "post_link", title: "Launch checklist for a community SaaS", content: "Deployment notes, env variables, database migrations, and testing paths in one place.", kind: "link", linkUrl: "https://vercel.com/docs", communityId: "com_startups", authorId: "user_mira", createdAt: "2026-01-12T14:10:00.000Z" },
    { id: "post_image", title: "Empty states that invite contribution beat blank dashboards", content: "A useful empty state explains what belongs here and gives the next action.", kind: "image", imageUrl: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80", communityId: "com_design", authorId: "user_ada", createdAt: "2026-01-10T18:40:00.000Z" },
  ],
  comments: [
    { id: "comment_1", content: "Agree. Nested comments are tempting, but flat comments make moderation and UX easier for the MVP.", postId: "post_launch", authorId: "user_mira", createdAt: "2026-01-11T16:10:00.000Z" },
    { id: "comment_2", content: "The compound unique vote constraint is the piece a lot of clones forget.", postId: "post_schema", authorId: "user_ada", createdAt: "2026-01-12T11:30:00.000Z" },
  ],
  votes: [
    { id: "vote_1", postId: "post_launch", userId: "user_mira", type: "UPVOTE" },
    { id: "vote_2", postId: "post_schema", userId: "user_ada", type: "UPVOTE" },
    { id: "vote_3", postId: "post_schema", userId: "user_mira", type: "UPVOTE" },
    { id: "vote_4", postId: "post_link", userId: "user_ada", type: "UPVOTE" },
    { id: "vote_5", postId: "post_image", userId: "user_mira", type: "UPVOTE" },
  ],
};

function loadDb(): Database {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : seedDb;
  } catch {
    return seedDb;
  }
}

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "");
}

async function hashPassword(password: string) {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function relativeTime(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(diff / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function safeUrl(url?: string) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

export default function App() {
  const [db, setDb] = useState<Database>(() => loadDb());
  const [sessionUserId, setSessionUserId] = useState(() => localStorage.getItem(SESSION_KEY) ?? "");
  const [route, setRoute] = useState(() => window.location.hash.replace("#", "") || "/");
  const [sort, setSort] = useState<SortMode>("latest");
  const [query, setQuery] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register" | null>(null);
  const [showPostComposer, setShowPostComposer] = useState(false);
  const [showCommunityComposer, setShowCommunityComposer] = useState(false);
  const [toast, setToast] = useState("");
  const [booting, setBooting] = useState(true);

  useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(db)), [db]);
  useEffect(() => {
    if (sessionUserId) localStorage.setItem(SESSION_KEY, sessionUserId);
    else localStorage.removeItem(SESSION_KEY);
  }, [sessionUserId]);
  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash.replace("#", "") || "/");
    window.addEventListener("hashchange", onHashChange);
    const timer = window.setTimeout(() => setBooting(false), 550);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      window.clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const currentUser = useMemo(() => db.users.find((user) => user.id === sessionUserId) ?? null, [db.users, sessionUserId]);
  const postStats = useMemo(() => {
    const map = new Map<string, { score: number; comments: number }>();
    db.posts.forEach((post) => {
      const score = db.votes.reduce((total, vote) => (vote.postId === post.id ? total + (vote.type === "UPVOTE" ? 1 : -1) : total), 0);
      map.set(post.id, { score, comments: db.comments.filter((comment) => comment.postId === post.id).length });
    });
    return map;
  }, [db.comments, db.posts, db.votes]);
  const activeCommunitySlug = route.match(/^\/r\/([^/]+)$/)?.[1] ?? "";
  const activeCommunity = db.communities.find((community) => community.slug === activeCommunitySlug) ?? null;
  const detailPost = db.posts.find((post) => post.id === (route.match(/^\/post\/([^/]+)$/)?.[1] ?? "")) ?? null;
  const topCommunities = useMemo(() => [...db.communities].sort((a, b) => db.posts.filter((p) => p.communityId === b.id).length - db.posts.filter((p) => p.communityId === a.id).length), [db.communities, db.posts]);
  const visiblePosts = useMemo(() => {
    const lowerQuery = query.toLowerCase().trim();
    return [...db.posts]
      .filter((post) => (activeCommunity ? post.communityId === activeCommunity.id : true))
      .filter((post) => {
        if (!lowerQuery) return true;
        const communityName = db.communities.find((item) => item.id === post.communityId)?.name ?? "";
        return [post.title, post.content, communityName].join(" ").toLowerCase().includes(lowerQuery);
      })
      .sort((a, b) => {
        if (sort === "latest") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        const aStats = postStats.get(a.id) ?? { score: 0, comments: 0 };
        const bStats = postStats.get(b.id) ?? { score: 0, comments: 0 };
        if (sort === "popular") return bStats.score - aStats.score || bStats.comments - aStats.comments;
        const aAge = Math.max(1, (Date.now() - new Date(a.createdAt).getTime()) / 3600000);
        const bAge = Math.max(1, (Date.now() - new Date(b.createdAt).getTime()) / 3600000);
        return (bStats.score * 2 + bStats.comments) / bAge - (aStats.score * 2 + aStats.comments) / aAge;
      });
  }, [activeCommunity, db.communities, db.posts, postStats, query, sort]);

  const navigate = (path: string) => {
    window.location.hash = path;
    setRoute(path);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const requireAuth = (message: string) => {
    if (currentUser) return true;
    setToast(message);
    setAuthMode("login");
    return false;
  };
  const handleVote = (postId: string, type: VoteType) => {
    if (!requireAuth("Log in to vote on posts.")) return;
    setDb((draft) => {
      const existing = draft.votes.find((vote) => vote.postId === postId && vote.userId === currentUser!.id);
      if (!existing) return { ...draft, votes: [...draft.votes, { id: uid("vote"), postId, userId: currentUser!.id, type }] };
      if (existing.type === type) return { ...draft, votes: draft.votes.filter((vote) => vote.id !== existing.id) };
      return { ...draft, votes: draft.votes.map((vote) => (vote.id === existing.id ? { ...vote, type } : vote)) };
    });
  };
  const handleDeletePost = (postId: string) => {
    setDb((draft) => ({ ...draft, posts: draft.posts.filter((post) => post.id !== postId), comments: draft.comments.filter((comment) => comment.postId !== postId), votes: draft.votes.filter((vote) => vote.postId !== postId) }));
    setToast("Post deleted.");
    if (route.startsWith("/post/")) navigate("/");
  };

  return (
    <div className="min-h-screen bg-[#f6f7f8] text-slate-950">
      <TopNav currentUser={currentUser} query={query} setQuery={setQuery} onLogin={() => setAuthMode("login")} onRegister={() => setAuthMode("register")} onLogout={() => { setSessionUserId(""); setToast("Logged out."); }} onCreatePost={() => (requireAuth("Log in to create a post.") ? setShowPostComposer(true) : null)} onHome={() => navigate("/")} />
      <main className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-5 px-4 pb-10 pt-5 lg:grid-cols-[250px_minmax(0,1fr)_290px]">
        <Sidebar communities={topCommunities} activeSlug={activeCommunitySlug} onNavigate={navigate} onCreateCommunity={() => (requireAuth("Log in to create a community.") ? setShowCommunityComposer(true) : null)} />
        <section className="min-w-0 animate-[fadeIn_.35s_ease-out]">
          {route === "/" && <HomeHeader sort={sort} setSort={setSort} onCreatePost={() => (requireAuth("Log in to create a post.") ? setShowPostComposer(true) : null)} currentUser={currentUser} />}
          {activeCommunity && <CommunityHeader community={activeCommunity} posts={db.posts.filter((post) => post.communityId === activeCommunity.id).length} sort={sort} setSort={setSort} onCreatePost={() => (requireAuth("Log in to create a post.") ? setShowPostComposer(true) : null)} />}
          {route === "/communities" && <CommunitiesPage communities={topCommunities} posts={db.posts} onNavigate={navigate} onCreateCommunity={() => (requireAuth("Log in to create a community.") ? setShowCommunityComposer(true) : null)} />}
          {route === "/profile" && <ProfilePage currentUser={currentUser} posts={db.posts} comments={db.comments} onLogin={() => setAuthMode("login")} />}
          {route === "/architecture" && <ArchitecturePage />}
          {route.startsWith("/post/") && <PostDetail post={detailPost} db={db} currentUser={currentUser} postStats={postStats} onVote={handleVote} onBack={() => navigate("/")} onNavigate={navigate} onLogin={() => setAuthMode("login")} onDelete={handleDeletePost} onAddComment={(postId, content) => { if (!requireAuth("Log in to comment.")) return; setDb((draft) => ({ ...draft, comments: [...draft.comments, { id: uid("comment"), postId, content: content.trim(), authorId: currentUser!.id, createdAt: now() }] })); setToast("Comment posted."); }} />}
          {(route === "/" || activeCommunity) && <div className="space-y-3">{booting ? <SkeletonFeed /> : visiblePosts.length ? visiblePosts.map((post) => <PostCard key={post.id} post={post} db={db} currentUser={currentUser} stats={postStats.get(post.id) ?? { score: 0, comments: 0 }} onVote={handleVote} onOpen={() => navigate(`/post/${post.id}`)} onCommunity={() => navigate(`/r/${db.communities.find((item) => item.id === post.communityId)?.slug}`)} onDelete={handleDeletePost} />) : <EmptyState title="No discussions yet" body="Start the first post for this view, or adjust your search terms." action="Create post" onAction={() => (requireAuth("Log in to create a post.") ? setShowPostComposer(true) : null)} />}</div>}
        </section>
        <RightRail communities={topCommunities} posts={db.posts} comments={db.comments} votes={db.votes} onNavigate={navigate} />
      </main>
      {authMode && <AuthModal mode={authMode} setMode={setAuthMode} db={db} onClose={() => setAuthMode(null)} onAuthed={(nextDb, userId) => { setDb(nextDb); setSessionUserId(userId); setAuthMode(null); setToast("Session started."); }} />}
      {showPostComposer && <PostComposer communities={db.communities} activeCommunityId={activeCommunity?.id} onClose={() => setShowPostComposer(false)} onCreate={(post) => { setDb((draft) => ({ ...draft, posts: [{ ...post, authorId: currentUser!.id }, ...draft.posts] })); setShowPostComposer(false); setToast("Post published."); navigate(`/post/${post.id}`); }} />}
      {showCommunityComposer && <CommunityComposer communities={db.communities} onClose={() => setShowCommunityComposer(false)} onCreate={(community) => { setDb((draft) => ({ ...draft, communities: [...draft.communities, community] })); setShowCommunityComposer(false); setToast("Community created."); navigate(`/r/${community.slug}`); }} />}
      {toast && <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 animate-[toastIn_.2s_ease-out] rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-2xl shadow-slate-400/50">{toast}</div>}
    </div>
  );
}

function TopNav({ currentUser, query, setQuery, onLogin, onRegister, onLogout, onCreatePost, onHome }: { currentUser: User | null; query: string; setQuery: (value: string) => void; onLogin: () => void; onRegister: () => void; onLogout: () => void; onCreatePost: () => void; onHome: () => void }) {
  return <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur"><div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4"><button onClick={onHome} className="flex items-center gap-2 text-left" aria-label="Go home"><span className="grid h-9 w-9 place-items-center rounded-full bg-orange-600 text-sm font-black text-white shadow-lg shadow-orange-200">tl</span><span className="hidden sm:block"><span className="block text-lg font-black tracking-tight">Threadline</span><span className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">community SaaS</span></span></button><label className="relative ml-auto flex flex-1 items-center lg:max-w-xl"><SearchIcon className="pointer-events-none absolute left-3 h-4 w-4 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search posts, communities, and discussions" className="h-10 w-full rounded-full border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100" /></label><button onClick={onCreatePost} className="hidden rounded-full bg-orange-600 px-4 py-2 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:bg-orange-700 sm:inline-flex">Create</button>{currentUser ? <div className="group relative"><button className="flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-3 text-sm font-bold transition hover:border-slate-300"><Avatar label={currentUser.image || currentUser.username.slice(0, 2)} /><span className="hidden md:inline">{currentUser.username}</span></button><div className="invisible absolute right-0 top-11 w-44 translate-y-1 rounded-2xl border border-slate-200 bg-white p-2 opacity-0 shadow-xl transition group-hover:visible group-hover:translate-y-0 group-hover:opacity-100"><a href="#/profile" className="block rounded-xl px-3 py-2 text-sm font-semibold hover:bg-slate-100">Profile</a><button onClick={onLogout} className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-slate-100">Logout</button></div></div> : <div className="flex items-center gap-2"><button onClick={onLogin} className="rounded-full px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100">Login</button><button onClick={onRegister} className="rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800">Sign up</button></div>}</div></header>;
}

function Sidebar({ communities, activeSlug, onNavigate, onCreateCommunity }: { communities: Community[]; activeSlug: string; onNavigate: (path: string) => void; onCreateCommunity: () => void }) {
  return <aside className="hidden lg:block"><div className="sticky top-21 space-y-5"><nav className="space-y-1 text-sm font-semibold"><button onClick={() => onNavigate("/")} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-white"><HomeIcon className="h-4 w-4" />Home feed</button><button onClick={() => onNavigate("/communities")} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-white"><GridIcon className="h-4 w-4" />Communities</button><button onClick={() => onNavigate("/architecture")} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-white"><CodeIcon className="h-4 w-4" />Architecture</button></nav><div><div className="mb-2 flex items-center justify-between px-3"><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Feeds</p><button onClick={onCreateCommunity} className="text-xs font-black text-orange-700 hover:text-orange-800">New</button></div><div className="space-y-1">{communities.map((community) => <button key={community.id} onClick={() => onNavigate(`/r/${community.slug}`)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition ${activeSlug === community.slug ? "bg-white font-black text-orange-700 shadow-sm" : "font-semibold hover:bg-white"}`}><CommunityMark name={community.name} /><span className="truncate">r/{community.slug}</span></button>)}</div></div></div></aside>;
}

function HomeHeader({ sort, setSort, onCreatePost, currentUser }: { sort: SortMode; setSort: (sort: SortMode) => void; onCreatePost: () => void; currentUser: User | null }) {
  return <div className="mb-4 overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white"><div className="relative isolate px-5 py-6 sm:px-7"><div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,#fed7aa,transparent_30%),linear-gradient(135deg,#fff_0%,#fff7ed_100%)]" /><div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between"><div className="max-w-2xl"><p className="mb-2 text-sm font-black uppercase tracking-[0.18em] text-orange-700">Threadline MVP</p><h1 className="text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">Find the conversations worth building on.</h1><p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">A production-minded Reddit clone prototype with auth flows, communities, posts, comments, vote toggles, and feed sorting.</p></div><button onClick={onCreatePost} className="rounded-full bg-orange-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-orange-200 transition hover:-translate-y-0.5 hover:bg-orange-700">{currentUser ? "Start a discussion" : "Login to post"}</button></div></div><SortTabs sort={sort} setSort={setSort} /></div>;
}

function CommunityHeader({ community, posts, sort, setSort, onCreatePost }: { community: Community; posts: number; sort: SortMode; setSort: (sort: SortMode) => void; onCreatePost: () => void }) {
  return <div className="mb-4 overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white"><div className="h-20 bg-gradient-to-r from-orange-600 via-amber-500 to-slate-950" /><div className="px-5 pb-5 sm:px-7"><div className="-mt-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><CommunityMark name={community.name} large /><h1 className="mt-3 text-3xl font-black tracking-tight">r/{community.slug}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{community.description}</p><p className="mt-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{posts} posts</p></div><button onClick={onCreatePost} className="rounded-full bg-slate-950 px-5 py-3 text-sm font-black text-white hover:bg-slate-800">Post here</button></div></div><SortTabs sort={sort} setSort={setSort} /></div>;
}

function SortTabs({ sort, setSort }: { sort: SortMode; setSort: (sort: SortMode) => void }) {
  return <div className="flex gap-2 border-t border-slate-100 px-3 py-3">{(["latest", "popular", "trending"] as SortMode[]).map((tab) => <button key={tab} onClick={() => setSort(tab)} className={`rounded-full px-4 py-2 text-sm font-black capitalize transition ${sort === tab ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{tab}</button>)}</div>;
}

function PostCard({ post, db, currentUser, stats, onVote, onOpen, onCommunity, onDelete }: { post: Post; db: Database; currentUser: User | null; stats: { score: number; comments: number }; onVote: (postId: string, type: VoteType) => void; onOpen: () => void; onCommunity: () => void; onDelete: (postId: string) => void }) {
  const author = db.users.find((user) => user.id === post.authorId);
  const community = db.communities.find((item) => item.id === post.communityId);
  const myVote = currentUser ? db.votes.find((vote) => vote.postId === post.id && vote.userId === currentUser.id)?.type : undefined;
  return <article className="group grid grid-cols-[54px_minmax(0,1fr)] overflow-hidden rounded-2xl border border-slate-200 bg-white transition hover:border-slate-300 hover:shadow-sm"><VoteColumn score={stats.score} myVote={myVote} onVote={(type) => onVote(post.id, type)} /><div className="min-w-0 px-4 py-4"><div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-slate-500"><button onClick={onCommunity} className="font-black text-slate-800 hover:text-orange-700">r/{community?.slug ?? "unknown"}</button><span>by u/{author?.username ?? "deleted"}</span><span>{relativeTime(post.createdAt)}</span></div><button onClick={onOpen} className="block w-full text-left"><h2 className="text-lg font-black leading-snug tracking-tight text-slate-950 group-hover:text-orange-700">{post.title}</h2><p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">{post.content}</p></button><PostAttachment post={post} /><div className="mt-4 flex flex-wrap items-center gap-2 text-sm font-bold text-slate-600"><button onClick={onOpen} className="rounded-full bg-slate-100 px-3 py-2 hover:bg-slate-200">{stats.comments} comments</button><button onClick={onOpen} className="rounded-full bg-slate-100 px-3 py-2 hover:bg-slate-200">Open thread</button>{currentUser?.id === post.authorId && <button onClick={() => onDelete(post.id)} className="rounded-full px-3 py-2 text-red-600 hover:bg-red-50">Delete</button>}</div></div></article>;
}

function VoteColumn({ score, myVote, onVote }: { score: number; myVote?: VoteType; onVote: (type: VoteType) => void }) {
  return <div className="flex flex-col items-center gap-1 bg-slate-50 px-2 py-4"><button onClick={() => onVote("UPVOTE")} className={`grid h-8 w-8 place-items-center rounded-full transition hover:bg-orange-100 ${myVote === "UPVOTE" ? "bg-orange-100 text-orange-700" : "text-slate-500"}`} aria-label="Upvote"><ChevronUpIcon className="h-5 w-5" /></button><span className="text-sm font-black tabular-nums">{score}</span><button onClick={() => onVote("DOWNVOTE")} className={`grid h-8 w-8 place-items-center rounded-full transition hover:bg-blue-100 ${myVote === "DOWNVOTE" ? "bg-blue-100 text-blue-700" : "text-slate-500"}`} aria-label="Downvote"><ChevronDownIcon className="h-5 w-5" /></button></div>;
}

function PostAttachment({ post }: { post: Post }) {
  if (post.kind === "image" && safeUrl(post.imageUrl)) return <img src={safeUrl(post.imageUrl)} alt="Post attachment" className="mt-4 max-h-[430px] w-full rounded-2xl object-cover" />;
  if (post.kind === "link" && safeUrl(post.linkUrl)) return <a href={safeUrl(post.linkUrl)} target="_blank" rel="noreferrer" className="mt-4 flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 hover:border-orange-200 hover:bg-orange-50"><span className="truncate">{post.linkUrl}</span><ExternalIcon className="ml-3 h-4 w-4 shrink-0" /></a>;
  return null;
}

function PostDetail({ post, db, currentUser, postStats, onVote, onBack, onNavigate, onLogin, onDelete, onAddComment }: { post: Post | null; db: Database; currentUser: User | null; postStats: Map<string, { score: number; comments: number }>; onVote: (postId: string, type: VoteType) => void; onBack: () => void; onNavigate: (path: string) => void; onLogin: () => void; onDelete: (postId: string) => void; onAddComment: (postId: string, content: string) => void }) {
  const [comment, setComment] = useState("");
  if (!post) return <EmptyState title="Post not found" body="This thread may have been deleted." action="Back to feed" onAction={onBack} />;
  const comments = db.comments.filter((item) => item.postId === post.id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const community = db.communities.find((item) => item.id === post.communityId);
  return <div className="space-y-4"><button onClick={onBack} className="mb-1 text-sm font-black text-slate-600 hover:text-orange-700">Back to feed</button><PostCard post={post} db={db} currentUser={currentUser} stats={postStats.get(post.id) ?? { score: 0, comments: 0 }} onVote={onVote} onOpen={() => null} onCommunity={() => onNavigate(`/r/${community?.slug}`)} onDelete={onDelete} /><section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><h2 className="text-lg font-black">Comments</h2>{currentUser ? <form className="mt-4" onSubmit={(event) => { event.preventDefault(); if (comment.trim().length < 2) return; onAddComment(post.id, comment); setComment(""); }}><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add to the discussion" className="min-h-28 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100" /><div className="mt-3 flex justify-end"><button className="rounded-full bg-orange-600 px-5 py-2.5 text-sm font-black text-white hover:bg-orange-700">Comment</button></div></form> : <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">Login to join the discussion. <button onClick={onLogin} className="font-black text-orange-700">Start session</button></div>}<div className="mt-5 space-y-4">{comments.length ? comments.map((item) => { const author = db.users.find((user) => user.id === item.authorId); return <div key={item.id} className="border-t border-slate-100 pt-4"><div className="mb-1 flex items-center gap-2 text-xs font-bold text-slate-500"><Avatar label={author?.image || author?.username.slice(0, 2) || "U"} small /><span className="text-slate-800">u/{author?.username ?? "deleted"}</span><span>{relativeTime(item.createdAt)}</span></div><p className="pl-8 text-sm leading-6 text-slate-700">{item.content}</p></div>; }) : <EmptyState title="No comments yet" body="Be the first person to add context or ask a follow-up." />}</div></section></div>;
}

function CommunitiesPage({ communities, posts, onNavigate, onCreateCommunity }: { communities: Community[]; posts: Post[]; onNavigate: (path: string) => void; onCreateCommunity: () => void }) {
  return <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5 sm:p-7"><div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-black uppercase tracking-[0.18em] text-orange-700">Directory</p><h1 className="mt-2 text-3xl font-black tracking-tight">Browse communities</h1><p className="mt-2 text-sm leading-6 text-slate-600">Every community has its own slug, description, post feed, and dynamic route.</p></div><button onClick={onCreateCommunity} className="rounded-full bg-slate-950 px-5 py-3 text-sm font-black text-white hover:bg-slate-800">Create community</button></div><div className="divide-y divide-slate-100">{communities.map((community) => <button key={community.id} onClick={() => onNavigate(`/r/${community.slug}`)} className="flex w-full items-center gap-4 py-4 text-left hover:bg-slate-50"><CommunityMark name={community.name} large /><span className="min-w-0 flex-1"><span className="block text-lg font-black">r/{community.slug}</span><span className="block text-sm leading-6 text-slate-600">{community.description}</span></span><span className="text-sm font-black text-slate-500">{posts.filter((post) => post.communityId === community.id).length} posts</span></button>)}</div></div>;
}

function ProfilePage({ currentUser, posts, comments, onLogin }: { currentUser: User | null; posts: Post[]; comments: Comment[]; onLogin: () => void }) {
  if (!currentUser) return <EmptyState title="Profile is protected" body="Login to view your profile, created posts, and comment activity." action="Login" onAction={onLogin} />;
  return <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5 sm:p-7"><div className="flex items-center gap-4"><Avatar label={currentUser.image || currentUser.username.slice(0, 2)} large /><div><h1 className="text-3xl font-black tracking-tight">u/{currentUser.username}</h1><p className="mt-1 text-sm font-semibold text-slate-500">Member since {new Date(currentUser.createdAt).toLocaleDateString()}</p></div></div><div className="mt-7 grid gap-4 sm:grid-cols-3"><Metric label="Posts" value={posts.filter((post) => post.authorId === currentUser.id).length} /><Metric label="Comments" value={comments.filter((comment) => comment.authorId === currentUser.id).length} /><Metric label="Security" value="Session" /></div></div>;
}

function ArchitecturePage() {
  const endpoints = ["POST /api/auth/register", "POST /api/auth/login", "GET /api/communities", "POST /api/communities", "GET /api/posts?sort=popular", "POST /api/posts/:id/vote", "GET /api/posts/:id/comments"];
  return <div className="space-y-4"><section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 sm:p-7"><p className="text-sm font-black uppercase tracking-[0.18em] text-orange-700">Production blueprint</p><h1 className="mt-2 text-3xl font-black tracking-tight">Next.js, Prisma, PostgreSQL architecture</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">This browser MVP mirrors the requested data relationships and actions. In production, these flows map to Next.js route handlers, Prisma models, server-side validation, and protected mutations.</p></section><section className="grid gap-4 md:grid-cols-2"><div className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-black">Core model relationships</h2><pre className="mt-4 overflow-auto rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">{"User -> posts, comments, votes\nCommunity -> posts\nPost -> author, community, comments, votes\nVote -> unique(userId, postId)"}</pre></div><div className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-black">API surface</h2><div className="mt-4 space-y-2">{endpoints.map((endpoint) => <div key={endpoint} className="rounded-xl bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">{endpoint}</div>)}</div></div></section></div>;
}

function RightRail({ communities, posts, comments, votes, onNavigate }: { communities: Community[]; posts: Post[]; comments: Comment[]; votes: Vote[]; onNavigate: (path: string) => void }) {
  return <aside className="hidden xl:block"><div className="sticky top-21 space-y-4"><div className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="text-base font-black">MVP coverage</h2><div className="mt-4 grid grid-cols-2 gap-3"><Metric label="Communities" value={communities.length} compact /><Metric label="Posts" value={posts.length} compact /><Metric label="Comments" value={comments.length} compact /><Metric label="Votes" value={votes.length} compact /></div></div><div className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="text-base font-black">Top communities</h2><div className="mt-3 space-y-2">{communities.slice(0, 4).map((community) => <button key={community.id} onClick={() => onNavigate(`/r/${community.slug}`)} className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-slate-50"><CommunityMark name={community.name} /><span className="min-w-0"><span className="block truncate text-sm font-black">r/{community.slug}</span><span className="block text-xs text-slate-500">{posts.filter((post) => post.communityId === community.id).length} posts</span></span></button>)}</div></div></div></aside>;
}

function AuthModal({ mode, setMode, db, onClose, onAuthed }: { mode: "login" | "register"; setMode: (mode: "login" | "register") => void; db: Database; onClose: () => void; onAuthed: (db: Database, userId: string) => void }) {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error("Enter a valid email address.");
      if (password.length < 6) throw new Error("Password must be at least 6 characters.");
      const passwordHash = await hashPassword(password);
      if (mode === "login") {
        const user = db.users.find((item) => item.email === normalizedEmail);
        if (!user || (user.passwordHash !== passwordHash && user.passwordHash !== "demo")) throw new Error("Invalid email or password.");
        onAuthed(db, user.id);
        return;
      }
      const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
      if (cleanUsername.length < 3) throw new Error("Username must be at least 3 characters.");
      if (db.users.some((item) => item.email === normalizedEmail)) throw new Error("Email is already registered.");
      if (db.users.some((item) => item.username === cleanUsername)) throw new Error("Username is already taken.");
      const user: User = { id: uid("user"), email: normalizedEmail, username: cleanUsername, passwordHash, image: cleanUsername.slice(0, 2).toUpperCase(), createdAt: now() };
      onAuthed({ ...db, users: [...db.users, user] }, user.id);
    } catch (err) { setError(err instanceof Error ? err.message : "Something went wrong."); } finally { setLoading(false); }
  };
  return <Modal onClose={onClose} title={mode === "login" ? "Login to Threadline" : "Create your account"}><form onSubmit={submit} className="space-y-4"><Field label="Email" value={email} onChange={setEmail} type="email" placeholder="you@example.com" />{mode === "register" && <Field label="Username" value={username} onChange={setUsername} placeholder="founder_42" />}<Field label="Password" value={password} onChange={setPassword} type="password" placeholder="Minimum 6 characters" />{mode === "login" && <p className="rounded-2xl bg-orange-50 p-3 text-xs font-semibold text-orange-900">Demo users are seeded. Use ada@example.com or mira@example.com with any password of 6+ characters.</p>}{error && <p className="rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}<button disabled={loading} className="w-full rounded-full bg-orange-600 px-5 py-3 text-sm font-black text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60">{loading ? "Securing session..." : mode === "login" ? "Login" : "Create account"}</button></form><button onClick={() => setMode(mode === "login" ? "register" : "login")} className="mt-4 w-full text-sm font-bold text-slate-600 hover:text-orange-700">{mode === "login" ? "Need an account? Sign up" : "Already have an account? Login"}</button></Modal>;
}

function PostComposer({ communities, activeCommunityId, onClose, onCreate }: { communities: Community[]; activeCommunityId?: string; onClose: () => void; onCreate: (post: Omit<Post, "authorId">) => void }) {
  const [communityId, setCommunityId] = useState(activeCommunityId || communities[0]?.id || "");
  const [kind, setKind] = useState<PostKind>("text");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!communityId) return setError("Choose a community.");
    if (title.trim().length < 6) return setError("Title must be at least 6 characters.");
    if (content.trim().length < 2) return setError("Post content is required.");
    if ((kind === "image" || kind === "link") && !safeUrl(url)) return setError("Enter a valid http or https URL.");
    onCreate({ id: uid("post"), title: title.trim(), content: content.trim(), kind, imageUrl: kind === "image" ? safeUrl(url) : undefined, linkUrl: kind === "link" ? safeUrl(url) : undefined, communityId, createdAt: now() });
  };
  return <Modal onClose={onClose} title="Create a post"><form onSubmit={submit} className="space-y-4"><label className="block text-sm font-black text-slate-700">Community<select value={communityId} onChange={(event) => setCommunityId(event.target.value)} className="mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100">{communities.map((community) => <option key={community.id} value={community.id}>r/{community.slug}</option>)}</select></label><div className="flex gap-2 rounded-2xl bg-slate-100 p-1">{(["text", "image", "link"] as PostKind[]).map((item) => <button key={item} type="button" onClick={() => setKind(item)} className={`flex-1 rounded-xl px-3 py-2 text-sm font-black capitalize ${kind === item ? "bg-white shadow-sm" : "text-slate-600"}`}>{item}</button>)}</div><Field label="Title" value={title} onChange={setTitle} placeholder="What do you want to discuss?" /><label className="block text-sm font-black text-slate-700">Body<textarea value={content} onChange={(event) => setContent(event.target.value)} className="mt-2 min-h-32 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100" placeholder="Add context, details, or a question." /></label>{kind !== "text" && <Field label={kind === "image" ? "Image URL" : "Link URL"} value={url} onChange={setUrl} placeholder="https://..." />}{error && <p className="rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}<button className="w-full rounded-full bg-orange-600 px-5 py-3 text-sm font-black text-white hover:bg-orange-700">Publish post</button></form></Modal>;
}

function CommunityComposer({ communities, onClose, onCreate }: { communities: Community[]; onClose: () => void; onCreate: (community: Community) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const slug = slugify(name);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (name.trim().length < 3) return setError("Community name must be at least 3 characters.");
    if (!slug) return setError("Community slug could not be generated.");
    if (communities.some((community) => community.slug === slug)) return setError("That community already exists.");
    onCreate({ id: uid("community"), name: name.trim(), slug, description: description.trim() || "A new place for focused discussion.", createdAt: now() });
  };
  return <Modal onClose={onClose} title="Create a community"><form onSubmit={submit} className="space-y-4"><Field label="Community name" value={name} onChange={setName} placeholder="Indie Hackers" /><p className="rounded-2xl bg-slate-50 p-3 text-sm font-semibold text-slate-600">Route preview: /r/{slug || "your-slug"}</p><label className="block text-sm font-black text-slate-700">Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} className="mt-2 min-h-28 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100" placeholder="What should people post here?" /></label>{error && <p className="rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}<button className="w-full rounded-full bg-orange-600 px-5 py-3 text-sm font-black text-white hover:bg-orange-700">Create community</button></form></Modal>;
}

function Modal({ children, title, onClose }: { children: ReactNode; title: string; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true"><div className="w-full max-w-lg animate-[modalIn_.2s_ease-out] rounded-[1.75rem] bg-white p-5 shadow-2xl shadow-slate-950/20 sm:p-6"><div className="mb-5 flex items-center justify-between gap-4"><h2 className="text-2xl font-black tracking-tight">{title}</h2><button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200" aria-label="Close modal"><CloseIcon className="h-4 w-4" /></button></div>{children}</div></div>;
}

function Field({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
  return <label className="block text-sm font-black text-slate-700">{label}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100" /></label>;
}

function EmptyState({ title, body, action, onAction }: { title: string; body: string; action?: string; onAction?: () => void }) {
  return <div className="rounded-[1.75rem] border border-dashed border-slate-300 bg-white p-8 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-orange-100 text-orange-700"><MessageIcon className="h-5 w-5" /></div><h2 className="mt-4 text-xl font-black">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">{body}</p>{action && onAction && <button onClick={onAction} className="mt-5 rounded-full bg-slate-950 px-5 py-3 text-sm font-black text-white hover:bg-slate-800">{action}</button>}</div>;
}

function SkeletonFeed() {
  return <div className="space-y-3">{[0, 1, 2].map((item) => <div key={item} className="grid grid-cols-[54px_minmax(0,1fr)] overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="bg-slate-50 p-3"><div className="h-24 animate-pulse rounded-full bg-slate-200" /></div><div className="space-y-3 p-4"><div className="h-3 w-40 animate-pulse rounded bg-slate-200" /><div className="h-5 w-3/4 animate-pulse rounded bg-slate-200" /><div className="h-3 w-full animate-pulse rounded bg-slate-100" /><div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" /></div></div>)}</div>;
}

function Metric({ label, value, compact }: { label: string; value: number | string; compact?: boolean }) {
  return <div className={`${compact ? "rounded-xl bg-slate-50 p-3" : "rounded-2xl bg-slate-50 p-4"}`}><p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{label}</p><p className="mt-2 text-2xl font-black tracking-tight">{value}</p></div>;
}

function Avatar({ label, small, large }: { label: string; small?: boolean; large?: boolean }) {
  return <span className={`grid shrink-0 place-items-center rounded-full bg-slate-950 font-black uppercase text-white ${large ? "h-16 w-16 text-lg" : small ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs"}`}>{label.slice(0, 2)}</span>;
}

function CommunityMark({ name, large }: { name: string; large?: boolean }) {
  return <span className={`grid shrink-0 place-items-center rounded-full bg-orange-600 font-black uppercase text-white shadow-md shadow-orange-100 ${large ? "h-16 w-16 text-xl" : "h-8 w-8 text-xs"}`}>{name.slice(0, 1)}</span>;
}

function Icon({ children, className = "h-5 w-5" }: { children: ReactNode; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}

const SearchIcon = ({ className }: { className?: string }) => <Icon className={className}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Icon>;
const HomeIcon = ({ className }: { className?: string }) => <Icon className={className}><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10" /></Icon>;
const GridIcon = ({ className }: { className?: string }) => <Icon className={className}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></Icon>;
const CodeIcon = ({ className }: { className?: string }) => <Icon className={className}><path d="m8 9-4 3 4 3" /><path d="m16 9 4 3-4 3" /><path d="m14 5-4 14" /></Icon>;
const ChevronUpIcon = ({ className }: { className?: string }) => <Icon className={className}><path d="m6 15 6-6 6 6" /></Icon>;
const ChevronDownIcon = ({ className }: { className?: string }) => <Icon className={className}><path d="m6 9 6 6 6-6" /></Icon>;
const ExternalIcon = ({ className }: { className?: string }) => <Icon className={className}><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></Icon>;
const CloseIcon = ({ className }: { className?: string }) => <Icon className={className}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Icon>;
const MessageIcon = ({ className }: { className?: string }) => <Icon className={className}><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" /></Icon>;