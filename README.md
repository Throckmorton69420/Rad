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