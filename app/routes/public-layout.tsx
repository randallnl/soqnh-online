import { useState } from "react";
import { Link, Outlet } from "react-router";

import { Icon } from "~/components/icon";

const socialLinks = [
	{ label: "Facebook", icon: "facebook", href: "https://www.facebook.com/QueerlectiveInc" },
	{ label: "Instagram", icon: "instagram", href: "https://www.instagram.com/queer_lective/" },
	{ label: "YouTube", icon: "youtube", href: "https://www.youtube.com/@Queerlective" },
	{ label: "TikTok", icon: "tiktok", href: "https://www.tiktok.com/@queer_lective" },
	{ label: "LinkedIn", icon: "linkedin", href: "https://www.linkedin.com/company/queerlective-inc/" },
] as const;

type SocialIconName = (typeof socialLinks)[number]["icon"];

function SocialIcon({ name }: { name: SocialIconName }) {
	return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
		{name === "facebook" && <path d="M14 21v-8h3l.5-3H14V8.5c0-1 .4-1.5 1.7-1.5H18V4.2c-.7-.1-1.6-.2-2.7-.2C12.6 4 11 5.6 11 8.3V10H8v3h3v8" />}
		{name === "instagram" && <><rect height="17" rx="4.5" width="17" x="3.5" y="3.5" /><circle cx="12" cy="12" r="3.7" /><circle className="social-icon-dot" cx="17.4" cy="6.7" r=".7" /></>}
		{name === "youtube" && <><rect height="13" rx="4" width="19" x="2.5" y="5.5" /><path className="social-icon-play" d="m10 9 5 3-5 3Z" /></>}
		{name === "tiktok" && <><path d="M15 4v10.2a4.2 4.2 0 1 1-3.6-4.2" /><path d="M15 4c.5 2.4 1.8 3.7 4 4.1" /></>}
		{name === "linkedin" && <><rect height="17" rx="2" width="17" x="3.5" y="3.5" /><path d="M8 10v7M8 7.3v.1M12 17v-7M12 13.2c0-1.8 1.2-3.2 2.8-3.2 1.7 0 2.7 1.2 2.7 3.3V17" /></>}
	</svg>;
}

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
					{socialLinks.map((item) => <a aria-label={`Queerlective on ${item.label}`} href={item.href} key={item.label} rel="noopener noreferrer" target="_blank"><SocialIcon name={item.icon} /></a>)}
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
