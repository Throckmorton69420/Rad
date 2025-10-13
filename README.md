# Radiology Core Exam Study Planner

This is an interactive, day-by-day study planner for radiology residents preparing for their Core Exam. It organizes study resources into a personalized schedule and helps manage study time effectively.

## Run Locally

**Prerequisites:** [Node.js](https://nodejs.org/) installed on your machine.

1.  **Install Dependencies:**
    Open your terminal, navigate to the project directory, and run:
    ```bash
    npm install
    ```

2.  **Set Up Environment Variables:**
    This project connects to a Supabase database to store and sync your study plan. You will need to provide your Supabase project's URL and anonymous key.

    *   Create a new file named `.env` in the root of your project directory.
    *   Add the following lines to the `.env` file, replacing the placeholder values with your actual Supabase credentials:
        ```
        VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
        VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
        ```
    *   You can find these values in your Supabase project dashboard under `Settings` > `API`.

3.  **Start the Development Server:**
    Once the dependencies are installed and your `.env` file is set up, start the local server with:
    ```bash
    npm run dev
    ```

4.  **Open in Browser:**
    Your application will now be running. You can access it by opening your web browser and navigating to `http://localhost:5173` (or the address shown in your terminal).

## Deploying to Vercel

When you deploy this project to Vercel, you need to configure the same environment variables you used in your local `.env` file. This is a critical step for the deployed application to connect to your Supabase database.

Here's how to do it:

1.  **Go to your Project Settings in Vercel:**
    Navigate to your project on the Vercel dashboard.

2.  **Find Environment Variables:**
    Click on the "Settings" tab, and then select "Environment Variables" from the side menu.

3.  **Add the Variables:**
    You need to add two environment variables, using the same names as in your `.env` file and the values from your Supabase project's API settings.

    *   **Variable 1:**
        *   **Name:** `VITE_SUPABASE_URL`
        *   **Value:** `[Your Supabase Project URL]`

    *   **Variable 2:**
        *   **Name:** `VITE_SUPABASE_ANON_KEY`
        *   **Value:** `[Your Supabase Anon Key]`

    *Important: Make sure the variables are available to all environments (Production, Preview, and Development) in the Vercel settings.*

4.  **Redeploy:**
    After adding and saving the variables, go to the "Deployments" tab for your project and trigger a new deployment for your latest commit. Vercel will use these new environment variables during the build process, and your application should connect to Supabase successfully.