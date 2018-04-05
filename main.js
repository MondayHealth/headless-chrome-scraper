import puppeteer from "puppeteer";

const BASE_URL = "https://www.aetna.com/dsepublic/#/contentPage?page=providerSearchLanding&site_id=dse&language=en";

class Page
{
	constructor(page) {
		this._page = page;
	}

	async go(url) {
		await this._page.goto(url);
	}

	async waitOn(selector, callback) {
		console.log("Waiting on selector", selector);
		return this._page.waitForSelector(selector, callback)
			.then(element => {
				console.log("Finished waiting on selector", selector);
				callback(element);
			})
			.catch(err => {
				console.error("Failed to wait on selector", selector, err);
			});
	}

	async actOn(selector, callback) {
		await this._page.$eval(selector, callback);
	}

}

// noinspection JSUnusedGlobalSymbols
export async function bootstrap() {
	const browser = await puppeteer.launch();
	const page = await browser.newPage();
	const p = new Page(page);
	p.go(BASE_URL).catch(() => undefined);
	await p.waitOn("input#zip1", result => result.value = "New York City, New York");
	await p.waitOn("button#second-step-continue", button => button.click());
	await p.waitOn('a.skipPlanBottom', elt => console.log(elt));

	/**
	 *
	 console.log("Waiting for first click.");
	 await page.waitForSelector('a.skipPlanBottom');
	 await page.$eval("a.skipPlanBottom", link => link.click());
	 const selector = 'a[title="Behavioral Health Professionals"]';
	 console.log("waiting for behavioral health a");
	 await page.waitForSelector(selector);
	 *
	 */

	await browser.close();
}

