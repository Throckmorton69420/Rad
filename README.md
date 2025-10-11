# Radiology Study Planner

This is an interactive, day-by-day study planner for radiology residents preparing for their Core Exam. It uses a sophisticated CP-SAT solver running on Google Cloud Run to generate an optimal schedule based on a comprehensive list of study resources.

## Architecture

This project uses a modern serverless architecture designed for robust, asynchronous background processing:

-   **Frontend**: Vite + React + TypeScript, deployed on Vercel.
-   **Backend Solver**: Python (Flask + Google OR-Tools), containerized and deployed on Google Cloud Run. The solver runs in a background task, allowing the API to respond immediately.
-   **Database**: Supabase (PostgreSQL) for storing resources, solver jobs, and user data.
-   **API Layer**: Vercel Serverless Functions act as a bridge, receiving requests from the frontend and making secure, authenticated calls directly to the backend solver.

## Setup Instructions

### 1. Supabase Setup

1.  Create a new project on [Supabase](https://supabase.com/).
2.  Navigate to the **SQL Editor**.
3.  Copy the entire contents of `sql/schema.sql` and run it to create the necessary tables (`resources`, `runs`, `schedule_slots`, `user_data`).
4.  Copy the entire contents of `sql/seed.sql` and run it to populate the `resources` table with the master list of study materials.
5.  Go to **Project Settings** > **API**.
    -   Find your **Project URL**.
    -   Find your **Project API Keys**. You will need the `anon` (public) key and the `service_role` (secret) key.

### 2. Google Cloud Setup

This is a one-time setup for the project's backend infrastructure.

#### Part A: Enable APIs

1.  Go to the [Google Cloud Console](https://console.cloud.google.com/).
2.  Ensure you are in the correct project.
3.  In the **search bar** at the top, find and **Enable** the following APIs if they are not already enabled:
    -   **Cloud Run API**
    -   **Cloud Build API**
    -   **IAM Credentials API** (This is needed for the Vercel function to generate auth tokens)

#### Part B: Create a Dedicated Service Account for Vercel

This service account provides secure credentials for your Vercel functions to authenticate with and trigger your Cloud Run solver.

1.  In the console search bar, type `IAM & Admin` and navigate to **Service Accounts**.
2.  Click **"+ CREATE SERVICE ACCOUNT"**.
3.  **Service account name:** Enter `vercel-task-creator`.
4.  Click **"CREATE AND CONTINUE"**.
5.  In the **"Select a role"** dropdown, grant the following single role:
    -   `Service Account Token Creator` (This is needed by the Google Auth Library to create tokens).
6.  Click **"CONTINUE"**, then click **"DONE"**.

#### Part C: Generate a JSON Key for the Service Account

1.  From the Service Accounts list, click on the email of the `vercel-task-creator` account you just made.
2.  Go to the **"KEYS"** tab.
3.  Click **"ADD KEY"** -> **"Create new key"**.
4.  Select **JSON** as the key type and click **"CREATE"**.
5.  A JSON file will download. **Treat this file as a password and never commit it to git.** You will need its contents for the Vercel setup.

### 3. Vercel Environment Variables Setup

In your Vercel project dashboard, go to **Settings > Environment Variables**. Add the following variables. **Note:** Both `SUPABASE_URL` and `VITE_SUPABASE_URL` are required and should have the same value (your Supabase Project URL).

| Variable Name                       | Value                                                                                                                                                                                                                                   | Description                                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`                      | Your Supabase Project URL.                                                                                                                                                                                                              | Used by server-side Vercel Functions (`/api/*`).                                                        |
| `VITE_SUPABASE_URL`                 | Your Supabase Project URL.                                                                                                                                                                                                              | Used by the client-side React application (prefixed with `VITE_`).                                      |
| `VITE_SUPABASE_ANON_KEY`            | Your Supabase `anon` (public) key.                                                                                                                                                                                                      | Used by the client-side React application.                                                              |
| `SUPABASE_SERVICE_ROLE_KEY`         | Your Supabase `service_role` (secret) key.                                                                                                                                                                                              | Used by server-side Vercel Functions for privileged database access.                                    |
| `GCP_PROJECT_ID`                    | Your Google Cloud Project ID (e.g., `scheduler-474709`).                                                                                                                                                                                | Your Google Cloud project identifier.                                                                   |
| `SOLVER_URL`                        | The URL of your deployed Google Cloud Run service (from the next step).                                                                                                                                                                 | The endpoint for the backend Python solver.                                                             |
| `GCP_SERVICE_ACCOUNT_KEY_BASE64`    | The **Base64 encoded** content of your downloaded JSON key file. To generate this: <br/> 1. On **macOS/Linux**, run: `cat your-key-file.json | base64 -w 0` <br/> 2. On **Windows (PowerShell)**, run: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("your-key-file.json"))` <br/> 3. Paste the resulting single-line string here. | Credentials for the Vercel Function to authenticate as the service account to invoke the Cloud Run solver. |


### 4. Backend Deployment to Google Cloud Run

1.  Ensure you have the `gcloud` CLI installed and authenticated (`gcloud auth login`).
2.  From your project's root directory, run the deployment command. **You must replace the placeholder values.**

    ```bash
    gcloud run deploy radiology-solver \
      --source . \
      --platform managed \
      --region us-central1 \
      --no-allow-unauthenticated \
      --set-env-vars="SUPABASE_URL=YOUR_SUPABASE_URL" \
      --set-env-vars="SUPABASE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY" \
      --timeout=900 \
      --cpu=1 \
      --memory=2Gi \
      --min-instances=0
    ```
    -   **CRITICAL:** Replace `YOUR_SUPABASE_URL` and `YOUR_SUPABASE_SERVICE_ROLE_KEY` with the actual values from your Supabase settings.
    -   `--no-allow-unauthenticated` ensures your service is private and can only be accessed by authenticated callers (like our Vercel function).

3.  After deployment, Cloud Run will show you a **Service URL**. Copy this URL and paste it into the `SOLVER_URL` environment variable in Vercel.

4.  **CRITICAL - Grant Permissions:** You must explicitly grant the `vercel-task-creator` service account permission to invoke your newly deployed service.
    -   In the Google Cloud Console, navigate to your `radiology-solver` Cloud Run service.
    -   Go to the **"Permissions"** tab.
    -   Click **"Add Principal"**.
    -   In the "New principals" field, paste the full email address of your `vercel-task-creator` service account (e.g., `vercel-task-creator@your-project-id.iam.gserviceaccount.com`).
    -   In the "Assign roles" dropdown, select the **"Cloud Run Invoker"** role.
    -   Click **"Save"**.

### 5. Frontend Deployment to Vercel

-   With all environment variables configured, push your code to the main branch linked to your Vercel project. Vercel will automatically build and deploy the frontend and serverless functions.
-   You may need to manually trigger a new deployment in the Vercel dashboard to ensure it uses the latest environment variables.

### Troubleshooting

**Problem: App is stuck at 0% or shows a "Failed to Generate Schedule" error.**

This is almost always an authentication, permissions, or environment variable issue where the Vercel function cannot successfully call the Cloud Run service or connect to the database.

1.  **Check Vercel Environment Variables:**
    -   Go to Vercel settings and ensure **all** variables from the table in Step 3 are present and correct.
    -   Pay special attention to `SUPABASE_URL` (for the API) vs `VITE_SUPABASE_URL` (for the client). They must both be set to the same Supabase URL.
    -   Ensure `SOLVER_URL` is the correct URL from your Cloud Run deployment.
    -   Re-check that `GCP_SERVICE_ACCOUNT_KEY_BASE64` was copied correctly without extra characters or line breaks.

2.  **Check Vercel Function Logs:**
    -   Go to your Vercel project dashboard.
    -   Click the **"Logs"** tab.
    -   Trigger a schedule generation in your app.
    -   Look for logs from the `/api/solve` function. The newly added logging will show detailed trace information. Look for any errors, especially messages like "Request failed with status 403" or "401". This indicates an authentication failure between Vercel and Google Cloud.

3.  **Verify Cloud Run Invoker Permission:**
    -   Go to your `radiology-solver` service in the Google Cloud Console.
    -   Go to the **"Permissions"** tab.
    -   Verify that your `vercel-task-creator@...` service account is listed as a Principal and has the **"Cloud Run Invoker"** role assigned to it. If it is missing, add it using the steps in "Part 4.4" above.

4.  **Check Cloud Run Environment Variables:**
    -   In your Cloud Run service's **"Revisions"** tab, verify that the `SUPABASE_URL` and `SUPABASE_KEY` environment variables are set correctly for the running revision. If they are wrong, the solver will fail to update its status.