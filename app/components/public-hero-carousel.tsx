import { useEffect, useState } from "react";
import { Link } from "react-router";

export type PublicHeroSlide = {
	id: string;
	eyebrow: string | null;
	headline: string;
	message: string;
	imageAlt: string;
	imageUrl: string;
	photoCredit: string | null;
	primaryButtonLabel: string | null;
	primaryButtonUrl: string | null;
	secondaryButtonLabel: string | null;
	secondaryButtonUrl: string | null;
};

function SlideLink({ label, url, secondary = false }: { label: string | null; url: string | null; secondary?: boolean }) {
	if (!label || !url) return null;
	const className = secondary ? "button public-home-hero-secondary" : "button button--primary";
	if (url.startsWith("/")) return <Link className={className} to={url}>{label}</Link>;
	return <a className={className} href={url} rel="noopener noreferrer" target="_blank">{label}</a>;
}

export function PublicHeroCarousel({ slides }: { slides: PublicHeroSlide[] }) {
	const [activeIndex, setActiveIndex] = useState(0);
	const [manualPaused, setManualPaused] = useState(false);
	const [interactionPaused, setInteractionPaused] = useState(false);
	const [reduceMotion, setReduceMotion] = useState(false);
	const paused = manualPaused || interactionPaused;

	useEffect(() => {
		const query = window.matchMedia("(prefers-reduced-motion: reduce)");
		const update = () => setReduceMotion(query.matches);
		update();
		query.addEventListener("change", update);
		return () => query.removeEventListener("change", update);
	}, []);

	useEffect(() => {
		if (slides.length < 2 || paused || reduceMotion) return;
		const timer = window.setInterval(() => setActiveIndex((index) => (index + 1) % slides.length), 7000);
		return () => window.clearInterval(timer);
	}, [paused, reduceMotion, slides.length]);

	useEffect(() => {
		if (activeIndex >= slides.length) setActiveIndex(0);
	}, [activeIndex, slides.length]);

	const move = (amount: number) => setActiveIndex((index) => (index + amount + slides.length) % slides.length);

	return <section
		aria-label="Featured community spotlights"
		aria-roledescription="carousel"
		className="public-home-carousel"
		onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setInteractionPaused(false); }}
		onFocusCapture={() => setInteractionPaused(true)}
		onMouseEnter={() => setInteractionPaused(true)}
		onMouseLeave={() => setInteractionPaused(false)}
	>
		<div aria-live="off" className="public-home-carousel-slides">
			{slides.map((slide, index) => <article
				aria-hidden={index !== activeIndex}
				aria-label={`${index + 1} of ${slides.length}: ${slide.headline}`}
				className={`public-directory-hero public-home-hero public-home-carousel-slide${index === activeIndex ? " public-home-carousel-slide--active" : ""}`}
				inert={index !== activeIndex}
				key={slide.id}
				style={{ backgroundImage: `linear-gradient(90deg, rgba(31, 15, 31, .86) 0%, rgba(31, 15, 31, .68) 52%, rgba(31, 15, 31, .4) 100%), url("${slide.imageUrl}")` }}
			>
				<span className="sr-only">Background image: {slide.imageAlt}</span>
				<div className="public-directory-hero-copy">
					{slide.eyebrow && <p className="eyebrow">{slide.eyebrow}</p>}
					<h1>{slide.headline}</h1>
					<p>{slide.message}</p>
					{(slide.primaryButtonLabel || slide.secondaryButtonLabel) && <div className="public-home-hero-actions">
						<SlideLink label={slide.primaryButtonLabel} url={slide.primaryButtonUrl} />
						<SlideLink label={slide.secondaryButtonLabel} secondary url={slide.secondaryButtonUrl} />
					</div>}
				</div>
				{slide.photoCredit && <p className="public-directory-photo-credit">{slide.photoCredit}</p>}
			</article>)}
		</div>
		{slides.length > 1 && <div className="public-home-carousel-controls">
			<button aria-label="Previous spotlight" onClick={() => move(-1)} type="button">←</button>
			<div aria-label="Choose a spotlight" className="public-home-carousel-dots" role="group">
				{slides.map((slide, index) => <button aria-label={`Show ${slide.headline}`} aria-pressed={index === activeIndex} key={slide.id} onClick={() => setActiveIndex(index)} type="button" />)}
			</div>
			<button aria-label="Next spotlight" onClick={() => move(1)} type="button">→</button>
			{!reduceMotion && <button aria-label={manualPaused ? "Resume automatic rotation" : "Pause automatic rotation"} className="public-home-carousel-pause" onClick={() => setManualPaused((value) => !value)} type="button">{manualPaused ? "Play" : "Pause"}</button>}
		</div>}
	</section>;
}
