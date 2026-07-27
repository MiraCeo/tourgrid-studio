ALTER TABLE works
    ALTER COLUMN author_name TYPE VARCHAR(10),
    ALTER COLUMN title TYPE VARCHAR(10);

ALTER TABLE works
    ADD CONSTRAINT works_author_name_length CHECK (
        author_name IS NULL OR char_length(author_name) <= 10
    ),
    ADD CONSTRAINT works_title_length CHECK (
        title IS NULL OR char_length(title) <= 10
    );
