import asyncio
import os
from playwright.async_api import async_playwright

async def test():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.set_viewport_size({'width': 1280, 'height': 800})

        # Test 1: Login page
        print("Navigating to http://localhost:3000/login...")
        await page.goto("http://localhost:3000/login", wait_until="networkidle", timeout=15000)
        await page.screenshot(path="C:/Users/talha/AppData/Local/Temp/crm-login.png")
        print("Login page screenshot saved!")
        print(f"URL: {page.url}")
        print(f"Title: {await page.title()}")

        email_input = await page.query_selector('input[type="email"]')
        pass_input = await page.query_selector('input[type="password"]')
        submit_btn = await page.query_selector('button[type="submit"]')
        print(f"Email input: {'YES' if email_input else 'NO'}")
        print(f"Password input: {'YES' if pass_input else 'NO'}")
        print(f"Submit button: {'YES' if submit_btn else 'NO'}")

        # Test 2: Root page redirect
        print()
        print("Navigating to http://localhost:3000/...")
        await page.goto("http://localhost:3000/", wait_until="networkidle", timeout=15000)
        print(f"Root redirected to: {page.url}")
        print(f"Correctly redirected to login: {'YES' if '/login' in page.url else 'NO'}")

        # Test 3: API redirect
        print()
        print("Navigating to http://localhost:3000/api/leads...")
        try:
            await page.goto("http://localhost:3000/api/leads", timeout=5000)
        except Exception as e:
            print(f"Navigated (exception: {type(e).__name__})")
        print(f"API redirect to: {page.url}")
        print(f"Correctly redirected to login: {'YES' if '/login' in page.url else 'NO'}")

        # Test 4: Register page
        print()
        print("Navigating to http://localhost:3000/register...")
        await page.goto("http://localhost:3000/register", wait_until="networkidle", timeout=15000)
        await page.screenshot(path="C:/Users/talha/AppData/Local/Temp/crm-register.png")
        print(f"Register page screenshot saved!")
        print(f"URL: {page.url}")

        await browser.close()
        print()
        print("=== ALL TESTS COMPLETE ===")

asyncio.run(test())