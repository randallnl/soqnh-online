import { useState } from "react";
import { Link, Outlet } from "react-router";

import { Icon } from "~/components/icon";

const socialLinks = [
	{ label: "Facebook", shortLabel: "f", href: "https://www.facebook.com/QueerlectiveInc" },
	{ label: "Instagram", shortLabel: "ig", href: "https://www.instagram.com/queer_lective/" },
	{ label: "YouTube", shortLabel: "yt", href: "https://www.youtube.com/@Queerlective" },
	{ label: "TikTok", shortLabel: "tk", href: "https://www.tiktok.com/@queer_lective" },
	{ label: "LinkedIn", shortLabel: "in", href: "https://www.linkedin.com/company/queerlective-inc/" },
];

const publicLinks = [
	{ label: "Home", href: "https://queerlective.com/" },
	{ label: "About", href: "https://queerlective.com/pages/about" },
	{ label: "Events", href: "https://queerlective.com/blogs/upcoming-events" },
	{ label: "Donate", href: "https://givebutter.com/queerlective" },
];

export default function PublicLayout() {
	const [menuOpen, setMenuOpen] = useState(false);
	return <div className="public-site">
		<a className="skip-link" href="#public-main">Skip to directory</a>
		<div className="public-utility-bar">
			<div className="public-utility-inner">
				<div aria-label="Queerlective social media" className="public-social-links">
					{socialLinks.map((item) => <a aria-label={item.label} href={item.href} key={item.label} rel="noopener noreferrer" target="_blank">{item.shortLabel}</a>)}
				</div>
				<nav aria-label="Queerlective utility navigation">
					<a href="https://queerlective.com/pages/about-us">FAQs</a>
					<a href="https://queerlective.com/pages/contact">Contact us</a>
				</nav>
			</div>
		</div>
		<header className={`public-header${menuOpen ? " public-header--open" : ""}`}>
			<a aria-label="Queerlective home" className="public-brand" href="https://queerlective.com/">
				<img alt="" src="/brand/queerlective-round.png" />
				<span><strong>Queerlective</strong><small>NH Connect directory</small></span>
			</a>
			<button aria-expanded={menuOpen} aria-label={menuOpen ? "Close public navigation" : "Open public navigation"} className="public-menu-button" onClick={() => setMenuOpen((open) => !open)} type="button">
				<Icon name={menuOpen ? "x" : "menu"} size={22} />
			</button>
			<nav aria-label="Public navigation" className="public-primary-nav">
				{publicLinks.map((item) => <a href={item.href} key={item.label} onClick={() => setMenuOpen(false)}>{item.label}</a>)}
				<Link aria-current="page" className="public-nav-active" onClick={() => setMenuOpen(false)} to="/">Directory</Link>
				<Link className="button button--primary button--compact" onClick={() => setMenuOpen(false)} to="/login?returnTo=/home">Member sign in</Link>
			</nav>
		</header>
		<main id="public-main"><Outlet /></main>
		<footer className="public-footer">
			<div><strong>NH Connect</strong><p>A public guide to affirming organizations and businesses across New Hampshire.</p></div>
			<div><span>Built and stewarded by Queerlective</span><Link to="/login?returnTo=/home">Member workspace</Link></div>
		</footer>
	</div>;
}
