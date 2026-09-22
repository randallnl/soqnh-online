import { Link, Outlet } from "react-router";

export default function PublicLayout() {
	return <div className="public-site">
		<a className="skip-link" href="#public-main">Skip to directory</a>
		<header className="public-header">
			<Link aria-label="NH Connect public directory" className="public-brand" to="/">
				<img alt="" src="/brand/queerlective-round.png" />
				<span><strong>NH Connect</strong><small>New Hampshire community directory</small></span>
			</Link>
			<nav aria-label="Public navigation">
				<Link to="/">Directory</Link>
				<Link className="button button--primary button--compact" to="/login?returnTo=/home">Member sign in</Link>
			</nav>
		</header>
		<main id="public-main"><Outlet /></main>
		<footer className="public-footer">
			<div><strong>NH Connect</strong><p>A public guide to affirming organizations and businesses across New Hampshire.</p></div>
			<div><span>Built and stewarded by Queerlective</span><Link to="/login?returnTo=/home">Member workspace</Link></div>
		</footer>
	</div>;
}
