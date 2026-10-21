/**
 * Owner opt-out ("notrack"): cookie `qviks_no_track=1`, set by the SERVER on
 * every domain we track (Safari keeps server-set cookies a year, script-set 7
 * days). Not HttpOnly, so the green dot can read it. Safe to import anywhere.
 *
 * The switch for all our sites lives on Qviks: www.qviks.com/notrack.
 */
export declare const NOTRACK_COOKIE = "qviks_no_track";
export declare const NOTRACK_MAX_AGE: number;
export declare const HUB_ORIGIN = "https://www.qviks.com";
export declare const HUB_URL = "https://www.qviks.com/notrack";
/**
 * Tester mode = the same opt-out cookie: the owner is not tracked AND a form
 * they send is a test. Lead relays add this header; Qviks then files the lead
 * in Miki's tests org, so the site's admin gets no email, no bell, no lead.
 */
export declare const TEST_HEADER = "x-qviks-test";
/** Headers to add to a Qviks lead call: the test flag when the tester cookie is set. */
export declare function testHeaders(cookieHeader: string | null | undefined): Record<string, string>;
/** Is the opt-out cookie set in this Cookie header / document.cookie? */
export declare function hasNotrackCookie(cookieHeader: string | null | undefined): boolean;
/**
 * Visitor id, mirrored from localStorage ("qviks-vid") into a first-party cookie so
 * server routes (lead form, chat) can tie a submission to the visits before it.
 */
export declare const VISITOR_COOKIE = "qviks_vid";
/** The visitor id from a Cookie header, or null. */
export declare function visitorIdFromCookie(cookieHeader: string | null | undefined): string | null;
