-- THIS IS RUN MANUALLY TO INITIALIZE THE DATABASE

CREATE ROLE sushii_admin;
CREATE ROLE sushii_visitor;
CREATE ROLE sushii_authenticator;

-- In production sushii-ansible creates these; migrations grant tables to them.
CREATE ROLE sushii_logs_reader;
CREATE ROLE sushii_mcp_reader;
