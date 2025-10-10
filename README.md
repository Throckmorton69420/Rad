# Radiology Study Planner

This is an interactive, day-by-day study planner for radiology residents preparing for their Core Exam. It uses a sophisticated CP-SAT solver running on Google Cloud Run to generate an optimal schedule based on a comprehensive list of study resources.

## Architecture

This project uses a modern serverless architecture:

-   **Frontend**: Vite + React + TypeScript, deployed on Vercel.
-   **Backend Solver**: Python (Flask + Google OR-Tools), containerized and deployed on Google Cloud Run.
-   **Database**: Supabase (PostgreSQL) for storing resources, solver jobs, and user data.
-   **Task Queue**: Google Cloud Tasks for reliably triggering long-running solver jobs asynchronously.
-   **API Layer**: Vercel Serverless Functions act as a bridge between the frontend and backend services.

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

This project requires a Google Cloud project to run the Python solver and the task queue.

#### Part A: Enable APIs

1.  Go to the [Google Cloud Console](https://console.cloud.google.com/).
2.  Select your project (`scheduler-474709`).
3.  In the search bar, find and **enable** the following APIs:
    -   **Cloud Run API**
    -   **Cloud Build API**
    -   **Cloud Tasks API**
    -   **IAM Service Account Credentials API**

#### Part B: Create a Task Queue

1.  Navigate to **Cloud Tasks** in the console.
2.  Click **"Create Queue"**.
3.  Select queue type **"HTTP"**.
4.  Give it a **Queue name** (e.g., `solver-queue`).
5.  Select the same **Region** you will deploy your Cloud Run service to (e.g., `us-central1`).
6.  Click **"Create"**.

#### Part C: Create a Service Account for Vercel

This service account allows your Vercel functions to securely create tasks in Google Cloud Tasks.

1.  Navigate to **IAM & Admin** > **Service Accounts**.
2.  Click **"Create Service Account"**.
3.  Give it a name (e.g., `vercel-task-creator`).
4.  Click **"Create and Continue"**.
5.  Grant the following two roles:
    -   `Cloud Tasks Enqueuer` (allows it to add tasks to a queue)
    -   `Cloud Run Invoker` (allows it to trigger your private Cloud Run service)
6.  Click **"Done"**.

#### Part D: Generate a JSON Key

1.  Find the `vercel-task-creator` service account in the list and click on it.
2.  Go to the **"Keys"** tab.
3.  Click **"Add Key"** -> **"Create new key"**.
4.  Select **JSON** as the key type and click **"Create"**.
5.  A JSON file will be downloaded to your computer. **This file is a secret credential. Do not commit it to git.**

### 3. Vercel Setup

1.  Create a new project on [Vercel](https://vercel.com/) and link it to your git repository.
2.  In the project settings, configure the following **Environment Variables**:
    -   `VITE_SUPABASE_URL`: Your Supabase Project URL.
    -   `VITE_SUPABASE_ANON_KEY`: Your Supabase `anon` (public) key.
    -   `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase `service_role` (secret) key.
    -   `GCP_PROJECT_ID`: Your Google Cloud project ID (e.g., `scheduler-474709`).
    -   `GCP_QUEUE_LOCATION`: The region of your Cloud Task queue (e.g., `us-central1`).
    -   `GCP_QUEUE_NAME`: The name of your Cloud Task queue (e.g., `solver-queue`).
    -   `SOLVER_URL`: The URL of your deployed Google Cloud Run service (you will get this after deploying the backend).
    -   `GCP_CLIENT_EMAIL`: The `client_email` from the JSON key file you downloaded.
    -   `GCP_PRIVATE_KEY`: The `private_key` from the JSON key file. Be sure to copy the entire string, including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` markers, and format it correctly for Vercel's multi-line variable input.

### 4. Backend Deployment (Google Cloud Run)

1.  Ensure you have the `gcloud` CLI installed and authenticated.
2.  Navigate to the root of your project in your terminal.
3.  Run the following command to build and deploy the solver. Replace `[SERVICE_ACCOUNT_EMAIL]` with the email of the default Compute Engine service account or another account with Supabase access.

    ```bash
    gcloud run deploy radiology-solver \
      --source . \
      --platform managed \
      --region us-central1 \
      --allow-unauthenticated \
      --set-env-vars="SUPABASE_URL=YOUR_SUPABASE_URL" \
      --set-env-vars="SUPABASE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY" \
      --set-env-vars="INTERNAL_API_TOKEN=SOME_RANDOM_SECRET_STRING" \
      --timeout=900 \
      --cpu=1 \
      --memory=2Gi \
      --min-instances=1
    ```
4. After deployment, Cloud Run will give you a **Service URL**. Copy this URL and set it as the `SOLVER_URL` environment variable in Vercel. You will also need to set the `INTERNAL_API_TOKEN` in your Vercel environment variables to match the one you set here.

5. **IMPORTANT**: After the first deployment, go back to the Cloud Run service, click "Edit & Deploy New Revision", go to the "Security" tab, and change **Ingress control** from "Allow all traffic" to **"Allow internal traffic and traffic from Cloud Load Balancing"**. This secures your internal solver endpoint so that only Google Cloud services (like Cloud Tasks) can call it. Deploy the revision.

### 5. Frontend Deployment (Vercel)

-   With all environment variables configured, push your code to the main branch linked to your Vercel project. Vercel will automatically build and deploy the frontend and serverless functions.
