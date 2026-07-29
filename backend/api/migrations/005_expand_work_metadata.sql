ALTER TABLE works
    DROP CONSTRAINT works_author_name_length,
    DROP CONSTRAINT works_title_length,
    ALTER COLUMN author_name TYPE VARCHAR(15),
    ALTER COLUMN title TYPE VARCHAR(15);

ALTER TABLE works
    ADD CONSTRAINT works_author_name_length CHECK (
        author_name IS NULL OR char_length(author_name) <= 15
    ),
    ADD CONSTRAINT works_title_length CHECK (
        title IS NULL OR char_length(title) <= 15
    );
